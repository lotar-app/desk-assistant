import { activityError } from "./errors.mjs";
import { canonicalJson, requestHash } from "./canonical-json.mjs";
import { normalizeActivityAlias } from "./normalization.mjs";

const CORE_FIELDS = Object.freeze(["status", "focus", "nextAction", "summary"]);
const ITEM_TYPES = Object.freeze(["DECISION", "CONTENT", "TECHNICAL_CONTEXT"]);

export class ProjectActivityWriteService {
  constructor(repository, readService, options = {}) {
    this.repository = repository;
    this.readService = readService;
    this.resolveProjectName = options.resolveProjectName;
    this.now = options.now || (() => new Date().toISOString());
    this.id = options.id || (() => crypto.randomUUID());
  }

  async update(request = {}) {
    const idempotencyKey = String(request.idempotencyKey || "").trim();
    if (!idempotencyKey || idempotencyKey.length > 200) {
      throw activityError("INVALID_PATCH", { field: "idempotencyKey" });
    }
    const hash = await requestHash(request);
    const replay = await this.repository.findIdempotency(idempotencyKey);
    if (replay) return this.replay(replay, hash);

    const project = await this.resolveProject(request.project);
    const resolution = await this.resolveActivity(request.activity, project.id);
    const created = !resolution.activity;
    const expected = request.expectedSnapshotVersion;
    if (created) {
      if (expected !== 0) {
        throw activityError("SNAPSHOT_VERSION_CONFLICT", {
          expected: 0, actual: null
        });
      }
    } else if (!Number.isInteger(expected) ||
        expected !== Number(resolution.activity.snapshot_version)) {
      throw activityError("SNAPSHOT_VERSION_CONFLICT", {
        expected, actual: Number(resolution.activity.snapshot_version)
      });
    }

    const now = this.now();
    const activity = created
      ? this.newActivity(request.activity, project.id, now)
      : { ...resolution.activity };
    const changedKeys = created ? ["activity"] : [];
    this.applyCorePatch(activity, request.patch, changedKeys);

    const operations = this.validateItemOperations(request.items);
    const itemKeys = [...new Set(operations.map(operation => operation.key))];
    const existingItems = itemKeys.length
      ? await this.repository.getItemsByKeys(activity.activity_id, itemKeys)
      : [];
    const itemPlans = this.planItems(activity, operations, existingItems, now);
    changedKeys.push(...itemPlans.changedKeys);

    const aliasPlans = await this.planAliases(
      activity,
      request.aliases,
      created,
      now
    );
    changedKeys.push(...aliasPlans.changedKeys);
    const uniqueChangedKeys = [...new Set(changedKeys)];
    const noOp = uniqueChangedKeys.length === 0;
    const nextVersion = created
      ? 1
      : Number(activity.snapshot_version) + (noOp ? 0 : 1);
    activity.snapshot_version = nextVersion;

    const eventId = noOp ? null : `EVT-${this.id()}`;
    if (!noOp) {
      activity.updated_at = now;
      activity.last_consolidated_at = now;
      activity.last_event_id = eventId;
    }
    itemPlans.revisions.forEach(revision => {
      revision.revisionId = `REV-${this.id()}`;
    });

    const compactRows = created ? [] : await this.repository.listCompactItems(
      activity.activity_id,
      this.readService.compactContentMaxBytes
    );
    const projectedRows = projectCompactRows(
      compactRows,
      itemPlans.itemUpserts,
      itemPlans.itemDeletes,
      this.readService.compactContentMaxBytes
    );
    const compact = this.readService.toResponse(
      activity,
      "COMPACT",
      projectedRows,
      [],
      project
    );
    const response = {
      success: true,
      activityId: activity.activity_id,
      projectId: activity.project_id,
      created,
      noOp,
      snapshotVersion: nextVersion,
      changedKeys: uniqueChangedKeys,
      timelineEventId: eventId,
      timelineDelivery: eventId ? "PENDING" : null,
      snapshot: compact
    };
    const source = String(request.source && request.source.type || "API");
    const outbox = eventId ? {
      eventId,
      eventType: created ? "PROJECT_ACTIVITY_CREATED" : "PROJECT_ACTIVITY_UPDATED",
      description: String(request.timeline && request.timeline.summary ||
        `${activity.canonical_name} ${created ? "created" : "updated"}.`),
      payload: {
        changedKeys: uniqueChangedKeys,
        snapshotVersion: nextVersion,
        source: request.source || { type: source },
        idempotencyKey,
        timelineSummary: String(request.timeline && request.timeline.summary || "")
      }
    } : null;
    const plan = {
      created, noOp, expectedSnapshotVersion: expected, idempotencyKey,
      requestHash: hash, response, now, activity, source,
      aliasAdds: aliasPlans.adds, aliasRemoves: aliasPlans.removes,
      itemUpserts: itemPlans.itemUpserts, itemDeletes: itemPlans.itemDeletes,
      revisions: itemPlans.revisions, outbox
    };
    try {
      await this.repository.commitWrite(plan);
      return response;
    } catch (error) {
      return this.resolveCommitFailure(plan, error);
    }
  }

  replay(record, hash) {
    if (record.request_hash !== hash) throw activityError("IDEMPOTENCY_CONFLICT");
    return JSON.parse(record.response_json);
  }

  async resolveCommitFailure(plan, originalError) {
    const replay = await this.repository.findIdempotency(plan.idempotencyKey);
    if (replay) return this.replay(replay, plan.requestHash);
    if (!plan.created) {
      const current = await this.repository.findById(plan.activity.activity_id);
      if (!current || Number(current.snapshot_version) !== plan.expectedSnapshotVersion) {
        throw activityError("SNAPSHOT_VERSION_CONFLICT", {
          expected: plan.expectedSnapshotVersion,
          actual: current ? Number(current.snapshot_version) : null
        });
      }
    }
    for (const alias of plan.aliasAdds) {
      const owner = await this.repository.findAlias(alias.projectId, alias.aliasKey);
      if (owner && owner.activity_id !== plan.activity.activity_id) {
        throw activityError("ALIAS_CONFLICT", { alias: alias.alias });
      }
    }
    throw originalError;
  }

  async resolveProject(input = {}) {
    const id = String(input.id || "").trim();
    const name = String(input.name || "").trim();
    if (id) {
      if (name && typeof this.resolveProjectName === "function") {
        const resolved = await this.resolveProjectName(name);
        if (!resolved || String(resolved.id) !== id) throw activityError("PROJECT_NOT_FOUND");
        return { id, name: String(resolved.name || name) };
      }
      return { id, name };
    }
    if (!name || typeof this.resolveProjectName !== "function") {
      throw activityError("PROJECT_NOT_FOUND");
    }
    const resolved = await this.resolveProjectName(name);
    if (!resolved || !resolved.id) throw activityError("PROJECT_NOT_FOUND");
    return { id: String(resolved.id), name: String(resolved.name || name) };
  }

  async resolveActivity(input = {}, projectId) {
    const id = String(input.id || "").trim();
    if (id) {
      const activity = await this.repository.findById(id);
      if (!activity || activity.project_id !== projectId) {
        throw activityError("ACTIVITY_NOT_FOUND");
      }
      return { activity };
    }
    const aliasKey = normalizeActivityAlias(input.name);
    const activity = aliasKey
      ? await this.repository.findByProjectAlias(projectId, aliasKey)
      : null;
    if (activity) return { activity };
    if (input.createIfMissing !== true) throw activityError("ACTIVITY_NOT_FOUND");
    if (!aliasKey || !String(input.kind || "").trim()) {
      throw activityError("INVALID_PATCH", { field: "activity" });
    }
    return { activity: null };
  }

  newActivity(input, projectId, now) {
    const canonicalName = String(input.name).trim();
    return {
      activity_id: `ACT-${this.id()}`, project_id: projectId,
      kind: String(input.kind).trim(), canonical_name: canonicalName,
      normalized_name: normalizeActivityAlias(canonicalName),
      status: "IN_PROGRESS", focus: null, next_action: null, summary: null,
      schema_version: 1, snapshot_version: 0, created_at: now,
      updated_at: now, last_consolidated_at: now, last_event_id: null
    };
  }

  applyCorePatch(activity, patch, changedKeys) {
    patch = patch || { set: {}, clear: [] };
    const set = patch.set || {};
    const clear = patch.clear || [];
    if (!isPlainObject(set) || !Array.isArray(clear) ||
        Object.keys(set).some(key => !CORE_FIELDS.includes(key)) ||
        clear.some(key => !CORE_FIELDS.includes(key)) ||
        clear.some(key => Object.hasOwn(set, key)) ||
        new Set(clear).size !== clear.length) {
      throw activityError("INVALID_PATCH");
    }
    Object.entries(set).forEach(([key, value]) => {
      if (typeof value !== "string") throw activityError("INVALID_PATCH", { field: key });
      const column = coreColumn(key);
      if (activity[column] !== value) {
        activity[column] = value;
        changedKeys.push(key);
      }
    });
    clear.forEach(key => {
      const column = coreColumn(key);
      const clearedValue = key === "status" ? "" : null;
      if (activity[column] !== clearedValue) {
        activity[column] = clearedValue;
        changedKeys.push(key);
      }
    });
  }

  validateItemOperations(items) {
    if (items === undefined) return [];
    if (!Array.isArray(items)) throw activityError("INVALID_ITEM_OPERATION");
    const keys = new Set();
    return items.map(item => {
      if (!isPlainObject(item)) throw activityError("INVALID_ITEM_OPERATION");
      const op = String(item.op || "").toUpperCase();
      const key = String(item.key || "").trim();
      if (!key || keys.has(key) || !["UPSERT", "DELETE"].includes(op)) {
        throw activityError("INVALID_ITEM_OPERATION");
      }
      keys.add(key);
      if (op === "DELETE" && !String(item.reason || "").trim()) {
        throw activityError("INVALID_ITEM_OPERATION", { key, reason: "required" });
      }
      if (op === "UPSERT") {
        if (item.type !== undefined && !ITEM_TYPES.includes(String(item.type))) {
          throw activityError("INVALID_ITEM_TYPE", { key });
        }
        if (!Object.hasOwn(item, "value")) throw activityError("INVALID_ITEM_OPERATION", { key });
        try { canonicalJson(item.value); } catch { throw activityError("INVALID_ITEM_OPERATION", { key }); }
      }
      return { ...item, op, key };
    });
  }

  planItems(activity, operations, existingRows, now) {
    const existing = new Map(existingRows.map(row => [row.item_key, row]));
    const plan = { itemUpserts: [], itemDeletes: [], revisions: [], changedKeys: [] };
    operations.forEach(operation => {
      const current = existing.get(operation.key);
      if (operation.op === "DELETE") {
        if (!current) return;
        const revision = Number(current.item_revision) + 1;
        plan.itemDeletes.push({ key: operation.key });
        plan.revisions.push({ key: operation.key, operation: "DELETE",
          previousValueJson: current.value_json, newValueJson: null,
          itemRevision: revision, reason: String(operation.reason).trim() });
        plan.changedKeys.push(operation.key);
        return;
      }
      const type = operation.type === undefined
        ? current && current.item_type
        : String(operation.type);
      if (!type) throw activityError("INVALID_ITEM_TYPE", { key: operation.key });
      if (!ITEM_TYPES.includes(type)) throw activityError("INVALID_ITEM_TYPE", { key: operation.key });
      const valueJson = canonicalJson(operation.value);
      if (current && current.item_type === type &&
          canonicalJson(JSON.parse(current.value_json)) === valueJson) return;
      const revision = current ? Number(current.item_revision) + 1 : 1;
      plan.itemUpserts.push({ key: operation.key, type, valueJson, revision,
        approvedAt: operation.approvedAt || now, updatedAt: now });
      plan.revisions.push({ key: operation.key, operation: "UPSERT",
        previousValueJson: current ? current.value_json : null,
        newValueJson: valueJson, itemRevision: revision,
        reason: String(operation.reason || "") });
      plan.changedKeys.push(operation.key);
    });
    return plan;
  }

  async planAliases(activity, aliases = {}, created) {
    if (!isPlainObject(aliases)) {
      throw activityError("INVALID_PATCH", { field: "aliases" });
    }
    if ((aliases.add !== undefined && !Array.isArray(aliases.add)) ||
        (aliases.remove !== undefined && !Array.isArray(aliases.remove))) {
      throw activityError("INVALID_PATCH", { field: "aliases" });
    }
    const add = Array.isArray(aliases.add) ? aliases.add : [];
    const remove = Array.isArray(aliases.remove) ? aliases.remove : [];
    const canonicalKey = normalizeActivityAlias(activity.canonical_name);
    const addKeys = new Set(add.map(normalizeActivityAlias));
    if (remove.some(alias => addKeys.has(normalizeActivityAlias(alias)))) {
      throw activityError("INVALID_PATCH", { field: "aliases", reason: "add_remove_overlap" });
    }
    const additions = created ? [activity.canonical_name, ...add] : [activity.canonical_name, ...add];
    const adds = [], removes = [], changedKeys = [], seen = new Set();
    for (const value of additions) {
      const alias = String(value || "").trim();
      const aliasKey = normalizeActivityAlias(alias);
      if (!aliasKey || seen.has(aliasKey)) continue;
      seen.add(aliasKey);
      const owner = await this.repository.findAlias(activity.project_id, aliasKey);
      if (owner && owner.activity_id !== activity.activity_id) {
        throw activityError("ALIAS_CONFLICT", { alias });
      }
      if (!owner) {
        adds.push({ projectId: activity.project_id, aliasKey, alias });
        changedKeys.push(`alias:+${aliasKey}`);
      }
    }
    for (const value of remove) {
      const alias = String(value || "").trim();
      const aliasKey = normalizeActivityAlias(alias);
      if (!aliasKey) throw activityError("INVALID_PATCH", { field: "aliases.remove" });
      if (aliasKey === canonicalKey) {
        throw activityError("INVALID_PATCH", { alias, reason: "canonical_alias_not_removable" });
      }
      const owner = await this.repository.findAlias(activity.project_id, aliasKey);
      if (!owner) continue;
      if (owner.activity_id !== activity.activity_id) {
        throw activityError("ALIAS_CONFLICT", { alias });
      }
      removes.push({ projectId: activity.project_id, aliasKey, alias });
      changedKeys.push(`alias:-${aliasKey}`);
    }
    return { adds, removes, changedKeys };
  }
}

function coreColumn(key) {
  return key === "nextAction" ? "next_action" : key;
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function projectCompactRows(rows, upserts, deletes, maxBytes) {
  const map = new Map(rows.map(row => [row.item_key, { ...row }]));
  deletes.forEach(item => map.delete(item.key));
  upserts.forEach(item => {
    const size = new TextEncoder().encode(item.valueJson).length;
    map.set(item.key, {
      activity_id: "", item_key: item.key, item_type: item.type,
      value_json: item.type === "DECISION" || size <= maxBytes ? item.valueJson : null,
      item_revision: item.revision, approved_at: item.approvedAt,
      updated_at: item.updatedAt, source_event_id: null, size_bytes: size
    });
  });
  return [...map.values()].sort((a, b) =>
    a.item_type.localeCompare(b.item_type) || a.item_key.localeCompare(b.item_key));
}
