const GET_OPERATION = "desk_v2_get_project_activity";
const UPDATE_OPERATION = "desk_v2_update_project_activity";
const ITEM_TYPES = new Set(["DECISION", "CONTENT", "TECHNICAL_CONTEXT"]);
const CORE_FIELDS = new Map([
  ["status", "status"], ["focus", "focus"],
  ["nextAction", "next_action"], ["summary", "summary"]
]);
const COMPACT_MAX_BYTES = 2048;

export class ProjectActivityDomainError extends Error {
  constructor(code, message, retryable = false, details = undefined) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export class ProjectActivityRepository {
  constructor(db) { this.db = db; }

  async getProjectActivity(input) {
    const activity = await this.#resolveForRead(input);
    const rows = input.mode === "KEYS"
      ? await this.#itemsByKeys(activity.activity_id, input.keys)
      : await this.#items(activity.activity_id);
    return activityResponse(activity, input.mode, rows, input.keys || []);
  }

  async updateProjectActivity(input) {
    const payload = canonicalJson(input);
    const hash = await sha256(payload);
    const receipt = await this.#receipt(input.idempotencyKey);
    if (receipt) return replay(receipt, hash);

    const project = await this.#container(input.projectId);
    if (!project) throw fail("PROJECT_NOT_FOUND", "The Project Container was not found.");
    if (project.lifecycle_state !== "ACTIVE") {
      throw fail("PROJECT_ARCHIVED", "Archived Projects cannot contain mutable activity memory.");
    }

    let activity = input.activityId
      ? await this.#activityById(input.activityId)
      : await this.#activityByAlias(input.projectId, normalizeActivityAlias(input.name));
    if (input.activityId && !activity) {
      throw fail("ACTIVITY_NOT_FOUND", "The ProjectActivity was not found.");
    }
    if (activity && activity.container_id !== input.projectId) {
      throw fail("ACTIVITY_NOT_FOUND", "The ProjectActivity was not found in this Project.");
    }
    const created = !activity;
    if (created && input.createIfMissing !== true) {
      throw fail("ACTIVITY_NOT_FOUND", "The ProjectActivity was not found.");
    }
    if (created && (!input.name || !input.kind)) {
      throw fail("INVALID_PATCH", "Creation requires a canonical name and kind.");
    }
    const actualVersion = activity ? Number(activity.snapshot_version) : 0;
    if (input.expectedSnapshotVersion !== actualVersion) {
      throw fail("SNAPSHOT_VERSION_CONFLICT", "The snapshot version is stale.", false,
        { expected: input.expectedSnapshotVersion, actual: actualVersion });
    }

    const now = new Date().toISOString();
    activity = activity ? { ...activity } : {
      activity_id: `ACT-${crypto.randomUUID()}`, container_id: input.projectId,
      kind: input.kind, canonical_name: input.name,
      normalized_name: normalizeActivityAlias(input.name), status: "IN_PROGRESS",
      focus: null, next_action: null, summary: null, schema_version: 1,
      snapshot_version: 0, created_at: now, updated_at: now,
      last_consolidated_at: now, last_event_id: null
    };
    const changedKeys = created ? ["activity"] : [];
    applyPatch(activity, input.patch, changedKeys);
    const itemKeys = input.items.map(item => item.key);
    const currentItems = new Map((itemKeys.length
      ? await this.#itemsByKeys(activity.activity_id, itemKeys) : [])
      .map(row => [row.item_key, row]));
    const itemPlan = planItems(input.items, currentItems, now);
    changedKeys.push(...itemPlan.changedKeys);
    const aliasPlan = await this.#planAliases(activity, input.aliases, created);
    changedKeys.push(...aliasPlan.changedKeys);
    const uniqueChangedKeys = [...new Set(changedKeys)];
    const noOp = uniqueChangedKeys.length === 0;
    const nextVersion = created ? 1 : actualVersion + (noOp ? 0 : 1);
    const event = noOp ? null : {
      eventId: `EVT-${crypto.randomUUID()}`, containerId: input.projectId,
      taskId: null, type: created ? "PROJECT_ACTIVITY_CREATED" : "PROJECT_ACTIVITY_UPDATED",
      description: input.timelineEvent?.description ||
        `${activity.canonical_name} ${created ? "created" : "updated"}.`,
      origin: UPDATE_OPERATION,
      occurredAt: now, idempotencyOperation: UPDATE_OPERATION,
      idempotencyKey: input.idempotencyKey
    };
    Object.assign(activity, {
      snapshot_version: nextVersion,
      updated_at: noOp ? activity.updated_at : now,
      last_consolidated_at: noOp ? activity.last_consolidated_at : now,
      last_event_id: event?.eventId ?? activity.last_event_id
    });
    const projectedItems = projectItems(currentItems, itemPlan);
    const response = {
      replayed: false, created, noOp, activityId: activity.activity_id,
      projectId: input.projectId, snapshotVersion: nextVersion,
      changedKeys: uniqueChangedKeys, timelineEvent: event,
      snapshot: activityResponse(activity, "COMPACT", [...projectedItems.values()], [])
    };
    const attemptId = crypto.randomUUID();
    const statements = [this.#acquire(input, activity, hash, attemptId, response, now, created)];
    if (created) statements.push(this.#insertActivity(activity, input, hash, attemptId));
    else if (!noOp) statements.push(this.#updateActivity(activity, input, hash, attemptId));
    for (const alias of aliasPlan.adds) statements.push(this.#addAlias(alias, activity, input, hash, attemptId, now));
    for (const alias of aliasPlan.removes) statements.push(this.#removeAlias(alias, activity, input, hash, attemptId));
    for (const item of itemPlan.upserts) statements.push(this.#upsertItem(item, activity, input, hash, attemptId, now));
    for (const item of itemPlan.deletes) statements.push(this.#deleteItem(item, activity, input, hash, attemptId));
    for (const revision of itemPlan.revisions) statements.push(this.#insertRevision(revision, activity, input, hash, attemptId, now));
    if (event) statements.push(this.#insertEvent(event, hash, attemptId));
    statements.push(this.db.prepare(`SELECT request_hash, response_json, attempt_id FROM mcp_idempotency WHERE operation = ? AND idempotency_key = ?`).bind(UPDATE_OPERATION, input.idempotencyKey));
    try {
      const results = await this.db.batch(statements);
      if (!Array.isArray(results) || results.some(result => result?.success === false)) throw new Error();
      const stored = results.at(-1)?.results?.[0];
      if (!stored) throw new Error();
      if (stored.request_hash !== hash) throw fail("IDEMPOTENCY_CONFLICT", "The idempotency key has a different payload.");
      const result = JSON.parse(stored.response_json);
      return stored.attempt_id === attemptId ? result : { ...result, replayed: true };
    } catch (error) {
      if (error instanceof ProjectActivityDomainError) throw error;
      const after = await this.#receipt(input.idempotencyKey);
      if (after) return replay(after, hash);
      const latest = await this.#activityById(activity.activity_id);
      if (!created && latest && Number(latest.snapshot_version) !== actualVersion) {
        throw fail("SNAPSHOT_VERSION_CONFLICT", "The snapshot version is stale.", false,
          { expected: actualVersion, actual: Number(latest.snapshot_version) });
      }
      throw fail("D1_OPERATION_FAILED", "ProjectActivity update failed atomically.", true);
    }
  }

  async #resolveForRead(input) {
    let activity;
    if (input.activityId) {
      activity = await this.#activityById(input.activityId);
      if (activity && input.projectId && activity.container_id !== input.projectId) activity = null;
    } else {
      const key = normalizeActivityAlias(input.name);
      if (input.projectId) activity = await this.#activityByAlias(input.projectId, key);
      else {
        const rows = await this.#globalAliases(key);
        if (rows.length > 1) throw fail("AMBIGUOUS_ACTIVITY",
          "The activity alias matches multiple Projects.", false,
          { candidates: rows.map(row => ({ projectId: row.container_id,
            activityId: row.activity_id, canonicalName: row.canonical_name })) });
        activity = rows[0] ? await this.#activityById(rows[0].activity_id) : null;
      }
    }
    if (!activity) throw fail("ACTIVITY_NOT_FOUND", "The ProjectActivity was not found.");
    return activity;
  }

  async #container(id) { return this.db.prepare(`SELECT container_id, lifecycle_state FROM containers WHERE container_id = ? LIMIT 1`).bind(id).first(); }
  async #activityById(id) { return this.db.prepare(`${activitySelect()} WHERE activity_id = ? LIMIT 1`).bind(id).first(); }
  async #activityByAlias(projectId, key) { return this.db.prepare(`${activitySelect("a")} JOIN project_activity_aliases x ON x.activity_id = a.activity_id WHERE x.container_id = ? AND x.alias_key = ? LIMIT 1`).bind(projectId, key).first(); }
  async #globalAliases(key) { return rows(await this.db.prepare(`SELECT a.activity_id, a.container_id, a.canonical_name FROM project_activity_aliases x JOIN project_activities a ON a.activity_id = x.activity_id WHERE x.alias_key = ? ORDER BY a.container_id, a.activity_id`).bind(key).all()); }
  async #items(id) { return rows(await this.db.prepare(`${itemSelect()} WHERE activity_id = ? ORDER BY item_type, item_key`).bind(id).all()); }
  async #itemsByKeys(id, keys) {
    if (!keys.length) return [];
    return rows(await this.db.prepare(`${itemSelect()} WHERE activity_id = ? AND item_key IN (${keys.map(() => "?").join(",")}) ORDER BY item_key`).bind(id, ...keys).all());
  }
  async #receipt(key) { return this.db.prepare(`SELECT request_hash, response_json, attempt_id FROM mcp_idempotency WHERE operation = ? AND idempotency_key = ? LIMIT 1`).bind(UPDATE_OPERATION, key).first(); }
  async #alias(projectId, key) { return this.db.prepare(`SELECT container_id, alias_key, alias, activity_id FROM project_activity_aliases WHERE container_id = ? AND alias_key = ? LIMIT 1`).bind(projectId, key).first(); }

  async #planAliases(activity, aliases, created) {
    const adds = [], removes = [], changedKeys = [];
    const addKeys = new Set(aliases.add.map(normalizeActivityAlias));
    if (aliases.remove.some(value => addKeys.has(normalizeActivityAlias(value)))) throw fail("INVALID_PATCH", "An alias cannot be added and removed together.");
    const canonicalKey = normalizeActivityAlias(activity.canonical_name);
    const seen = new Set();
    for (const alias of [activity.canonical_name, ...aliases.add]) {
      const key = normalizeActivityAlias(alias);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const owner = await this.#alias(activity.container_id, key);
      if (owner && owner.activity_id !== activity.activity_id) throw fail("ALIAS_CONFLICT", "The alias belongs to another activity.");
      if (!owner) { adds.push({ alias, key }); changedKeys.push(`alias:+${key}`); }
    }
    for (const alias of aliases.remove) {
      const key = normalizeActivityAlias(alias);
      if (key === canonicalKey) throw fail("INVALID_PATCH", "The canonical alias cannot be removed.");
      const owner = await this.#alias(activity.container_id, key);
      if (owner && owner.activity_id !== activity.activity_id) throw fail("ALIAS_CONFLICT", "The alias belongs to another activity.");
      if (owner) { removes.push({ alias, key }); changedKeys.push(`alias:-${key}`); }
    }
    return { adds, removes, changedKeys };
  }

  #guard(input, hash, attemptId) { return `EXISTS (SELECT 1 FROM mcp_idempotency WHERE operation = '${UPDATE_OPERATION}' AND idempotency_key = ? AND request_hash = ? AND attempt_id = ?)`; }
  #acquire(input, activity, hash, attemptId, response, now, created) {
    const activityGuard = created
      ? `AND NOT EXISTS (SELECT 1 FROM project_activities WHERE activity_id = ?)`
      : `AND EXISTS (SELECT 1 FROM project_activities WHERE activity_id = ? AND container_id = ? AND snapshot_version = ?)`;
    const extra = created ? [activity.activity_id] : [activity.activity_id, input.projectId, input.expectedSnapshotVersion];
    return this.db.prepare(`INSERT INTO mcp_idempotency (operation,idempotency_key,request_hash,attempt_id,resource_type,resource_id,response_json,completed_at)
      SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM containers WHERE container_id = ? AND lifecycle_state = 'ACTIVE') ${activityGuard}
      ON CONFLICT(operation,idempotency_key) DO NOTHING`).bind(UPDATE_OPERATION,input.idempotencyKey,hash,attemptId,"project_activity",activity.activity_id,JSON.stringify(response),now,input.projectId,...extra);
  }
  #insertActivity(a,input,hash,attempt) { return this.db.prepare(`INSERT INTO project_activities (activity_id,container_id,kind,canonical_name,normalized_name,status,focus,next_action,summary,schema_version,snapshot_version,created_at,updated_at,last_consolidated_at,last_event_id)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${this.#guard()}`).bind(a.activity_id,a.container_id,a.kind,a.canonical_name,a.normalized_name,a.status,a.focus,a.next_action,a.summary,a.schema_version,a.snapshot_version,a.created_at,a.updated_at,a.last_consolidated_at,a.last_event_id,input.idempotencyKey,hash,attempt); }
  #updateActivity(a,input,hash,attempt) { return this.db.prepare(`UPDATE project_activities SET status=?,focus=?,next_action=?,summary=?,snapshot_version=?,updated_at=?,last_consolidated_at=?,last_event_id=? WHERE activity_id=? AND snapshot_version=? AND ${this.#guard()}`).bind(a.status,a.focus,a.next_action,a.summary,a.snapshot_version,a.updated_at,a.last_consolidated_at,a.last_event_id,a.activity_id,input.expectedSnapshotVersion,input.idempotencyKey,hash,attempt); }
  #addAlias(x,a,input,hash,attempt,now) { return this.db.prepare(`INSERT INTO project_activity_aliases (container_id,alias_key,alias,activity_id,created_at) SELECT ?,?,?,?,? WHERE ${this.#guard()}`).bind(a.container_id,x.key,x.alias,a.activity_id,now,input.idempotencyKey,hash,attempt); }
  #removeAlias(x,a,input,hash,attempt) { return this.db.prepare(`DELETE FROM project_activity_aliases WHERE container_id=? AND alias_key=? AND activity_id=? AND ${this.#guard()}`).bind(a.container_id,x.key,a.activity_id,input.idempotencyKey,hash,attempt); }
  #upsertItem(x,a,input,hash,attempt,now) { return this.db.prepare(`INSERT INTO project_activity_items (activity_id,item_key,item_type,value_json,item_revision,approved_at,updated_at,source_event_id) SELECT ?,?,?,?,?,?,?,? WHERE ${this.#guard()} ON CONFLICT(activity_id,item_key) DO UPDATE SET item_type=excluded.item_type,value_json=excluded.value_json,item_revision=excluded.item_revision,approved_at=excluded.approved_at,updated_at=excluded.updated_at,source_event_id=excluded.source_event_id`).bind(a.activity_id,x.key,x.type,x.valueJson,x.revision,x.approvedAt,now,a.last_event_id,input.idempotencyKey,hash,attempt); }
  #deleteItem(x,a,input,hash,attempt) { return this.db.prepare(`DELETE FROM project_activity_items WHERE activity_id=? AND item_key=? AND ${this.#guard()}`).bind(a.activity_id,x.key,input.idempotencyKey,hash,attempt); }
  #insertRevision(x,a,input,hash,attempt,now) { return this.db.prepare(`INSERT INTO project_activity_item_revisions (revision_id,activity_id,item_key,operation,previous_value_json,new_value_json,item_revision,snapshot_version,changed_at,source,reason,idempotency_key) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE ${this.#guard()}`).bind(`REV-${crypto.randomUUID()}`,a.activity_id,x.key,x.operation,x.previousValueJson,x.newValueJson,x.revision,a.snapshot_version,now,input.source,x.reason,input.idempotencyKey,input.idempotencyKey,hash,attempt); }
  #insertEvent(e,hash,attempt) { return this.db.prepare(`INSERT INTO timeline_events (event_id,container_id,task_id,event_type,description,origin,occurred_at,idempotency_operation,idempotency_key) SELECT ?,?,?,?,?,?,?,?,? WHERE ${this.#guard()}`).bind(e.eventId,e.containerId,null,e.type,e.description,e.origin,e.occurredAt,e.idempotencyOperation,e.idempotencyKey,e.idempotencyKey,hash,attempt); }
}

export function normalizeActivityAlias(value) { return String(value ?? "").trim().normalize("NFKC").toLocaleLowerCase("und").replace(/\s+/gu, " "); }

function applyPatch(activity, patch, changed) {
  for (const [field, value] of Object.entries(patch.set)) {
    const column = CORE_FIELDS.get(field);
    if (activity[column] !== value) { activity[column] = value; changed.push(field); }
  }
  for (const field of patch.clear) {
    const column = CORE_FIELDS.get(field), value = field === "status" ? "" : null;
    if (activity[column] !== value) { activity[column] = value; changed.push(field); }
  }
}
function planItems(operations, current, now) {
  const plan = { upserts: [], deletes: [], revisions: [], changedKeys: [] };
  for (const operation of operations) {
    const old = current.get(operation.key);
    if (operation.op === "DELETE") {
      if (!old) continue;
      const revision = Number(old.item_revision) + 1;
      plan.deletes.push({ key: operation.key });
      plan.revisions.push({ key: operation.key, operation: "DELETE", previousValueJson: old.value_json, newValueJson: null, revision, reason: operation.reason });
      plan.changedKeys.push(operation.key); continue;
    }
    const type = operation.type || old?.item_type;
    if (!ITEM_TYPES.has(type)) throw fail("INVALID_ITEM_TYPE", "The item type is invalid.");
    const valueJson = canonicalJson(operation.value);
    if (old && old.item_type === type && canonicalJson(JSON.parse(old.value_json)) === valueJson) continue;
    const revision = old ? Number(old.item_revision) + 1 : 1;
    plan.upserts.push({ key: operation.key, type, valueJson, revision, approvedAt: operation.approvedAt || now });
    plan.revisions.push({ key: operation.key, operation: "UPSERT", previousValueJson: old?.value_json ?? null, newValueJson: valueJson, revision, reason: operation.reason || "" });
    plan.changedKeys.push(operation.key);
  }
  return plan;
}
function projectItems(current, plan) {
  const projected = new Map([...current].map(([key, value]) => [key, { ...value }]));
  for (const item of plan.deletes) projected.delete(item.key);
  for (const item of plan.upserts) projected.set(item.key, { item_key: item.key, item_type: item.type, value_json: item.valueJson, item_revision: item.revision, approved_at: item.approvedAt, updated_at: item.approvedAt, source_event_id: null });
  return projected;
}
function activityResponse(a, mode, rows, keys) {
  const core = { activityId:a.activity_id, projectId:a.container_id, kind:a.kind, canonicalName:a.canonical_name,status:a.status,focus:a.focus,nextAction:a.next_action,summary:a.summary,schemaVersion:Number(a.schema_version),snapshotVersion:Number(a.snapshot_version),createdAt:a.created_at,updatedAt:a.updated_at,lastConsolidatedAt:a.last_consolidated_at,lastEventId:a.last_event_id };
  const response = { activityId:a.activity_id, projectId:a.container_id, canonicalName:a.canonical_name, schemaVersion:Number(a.schema_version), snapshotVersion:Number(a.snapshot_version), mode, activity:core };
  const item = row => ({ type:row.item_type, value:JSON.parse(row.value_json), revision:Number(row.item_revision),approvedAt:row.approved_at,updatedAt:row.updated_at,sourceEventId:row.source_event_id,size:new TextEncoder().encode(row.value_json).length });
  const map = Object.fromEntries(rows.map(row => [row.item_key,item(row)]));
  if (mode === "FULL") return { ...response, items:map };
  if (mode === "KEYS") return { ...response, items:Object.fromEntries(keys.map(key => [key,map[key]||null])) };
  const compact = { decisionsApproved:{},technicalContext:{},technicalContextIndex:{},contentsApproved:{},approvedContentIndex:{} };
  for (const row of rows) { const value=item(row), metadata={...value}; delete metadata.value; const small=value.size<=COMPACT_MAX_BYTES;
    if(row.item_type==="DECISION") compact.decisionsApproved[row.item_key]=value;
    if(row.item_type==="CONTENT"){compact.approvedContentIndex[row.item_key]=metadata;if(small)compact.contentsApproved[row.item_key]=value;}
    if(row.item_type==="TECHNICAL_CONTEXT"){compact.technicalContextIndex[row.item_key]=metadata;if(small)compact.technicalContext[row.item_key]=value;}}
  return {...response,...compact};
}
function activitySelect(alias="") { const p=alias?`${alias}.`:""; return `SELECT ${p}activity_id,${p}container_id,${p}kind,${p}canonical_name,${p}normalized_name,${p}status,${p}focus,${p}next_action,${p}summary,${p}schema_version,${p}snapshot_version,${p}created_at,${p}updated_at,${p}last_consolidated_at,${p}last_event_id FROM project_activities ${alias}`; }
function itemSelect(){return `SELECT activity_id,item_key,item_type,value_json,item_revision,approved_at,updated_at,source_event_id FROM project_activity_items`;}
function rows(result){return result?.results||[];}
function fail(code,message,retryable=false,details){return new ProjectActivityDomainError(code,message,retryable,details);}
function replay(receipt,hash){if(receipt.request_hash!==hash)throw fail("IDEMPOTENCY_CONFLICT","The idempotency key has a different payload.");return {...JSON.parse(receipt.response_json),replayed:true};}
function canonicalJson(value){return JSON.stringify(canonicalValue(value));}
function canonicalValue(value){if(value===null||typeof value!=="object")return value;if(Array.isArray(value))return value.map(canonicalValue);return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalValue(value[key])]));}
async function sha256(value){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");}
