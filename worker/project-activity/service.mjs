import { activityError } from "./errors.mjs";
import { normalizeActivityAlias } from "./normalization.mjs";

export const PROJECT_ACTIVITY_MODES = Object.freeze(["COMPACT", "FULL", "KEYS"]);
export const COMPACT_CONTENT_MAX_BYTES = 2048;

export class ProjectActivityService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.resolveProjectName = options.resolveProjectName;
    this.compactContentMaxBytes = options.compactContentMaxBytes ??
      COMPACT_CONTENT_MAX_BYTES;
  }

  async get(request = {}) {
    const mode = String(request.mode || "COMPACT").trim().toUpperCase();
    if (!PROJECT_ACTIVITY_MODES.includes(mode)) throw activityError("INVALID_MODE");
    const keys = this.validateKeys(mode, request.keys);
    const project = await this.resolveProject(request);
    const activity = await this.resolveActivity(request, project);
    const rows = mode === "KEYS"
      ? await this.repository.getItemsByKeys(activity.activity_id, keys)
      : mode === "COMPACT"
        ? await this.repository.listCompactItems(
          activity.activity_id,
          this.compactContentMaxBytes
        )
        : await this.repository.listItems(activity.activity_id);
    return this.toResponse(activity, mode, rows, keys, project);
  }

  validateKeys(mode, keys) {
    if (mode !== "KEYS") return [];
    if (!Array.isArray(keys) || keys.length === 0) throw activityError("INVALID_KEYS");
    const normalized = keys.map(key => String(key || "").trim());
    if (normalized.some(key => !key) || new Set(normalized).size !== normalized.length) {
      throw activityError("INVALID_KEYS");
    }
    return normalized;
  }

  async resolveProject(request) {
    const projectId = String(request.projectId || "").trim();
    if (projectId) return { id: projectId, name: String(request.projectName || "") };
    const projectName = String(request.projectName || "").trim();
    if (!projectName) return null;
    if (typeof this.resolveProjectName !== "function") throw activityError("PROJECT_NOT_FOUND");
    const project = await this.resolveProjectName(projectName);
    if (!project || !project.id) throw activityError("PROJECT_NOT_FOUND");
    return { id: String(project.id), name: String(project.name || projectName) };
  }

  async resolveActivity(request, project) {
    const activityId = String(request.activityId || "").trim();
    if (activityId) {
      const activity = await this.repository.findById(activityId);
      if (!activity || (project && activity.project_id !== project.id)) {
        throw activityError("ACTIVITY_NOT_FOUND");
      }
      return activity;
    }
    const aliasKey = normalizeActivityAlias(request.activity);
    if (!aliasKey) throw activityError("ACTIVITY_NOT_FOUND");
    if (project) {
      const activity = await this.repository.findByProjectAlias(project.id, aliasKey);
      if (!activity) throw activityError("ACTIVITY_NOT_FOUND");
      return activity;
    }
    const candidates = await this.repository.findByGlobalAlias(aliasKey);
    if (candidates.length === 0) throw activityError("ACTIVITY_NOT_FOUND");
    if (candidates.length > 1) {
      throw activityError("AMBIGUOUS_ACTIVITY", {
        candidates: candidates.map(candidate => ({
          projectId: candidate.project_id,
          activityId: candidate.activity_id,
          canonicalName: candidate.canonical_name
        }))
      });
    }
    const activity = await this.repository.findById(candidates[0].activity_id);
    if (!activity) throw activityError("ACTIVITY_NOT_FOUND");
    return activity;
  }

  toResponse(activity, mode, rows, requestedKeys, project) {
    const core = this.toCore(activity, project);
    const response = {
      success: true,
      activityId: core.activityId,
      projectId: core.projectId,
      canonicalName: core.canonicalName,
      schemaVersion: core.schemaVersion,
      snapshotVersion: core.snapshotVersion,
      mode,
      activity: core
    };
    if (mode === "KEYS") {
      const byKey = this.itemMap(rows);
      response.items = Object.fromEntries(requestedKeys.map(key => [key, byKey[key] || null]));
      return response;
    }
    if (mode === "FULL") {
      response.items = this.itemMap(rows);
      return response;
    }
    return Object.assign(response, this.compactSections(rows));
  }

  toCore(row, project) {
    return {
      activityId: String(row.activity_id), projectId: String(row.project_id),
      projectName: project && project.id === row.project_id ? project.name : "",
      kind: String(row.kind), canonicalName: String(row.canonical_name),
      status: String(row.status), focus: row.focus ?? null,
      nextAction: row.next_action ?? null, summary: row.summary ?? null,
      schemaVersion: Number(row.schema_version),
      snapshotVersion: Number(row.snapshot_version), createdAt: row.created_at,
      updatedAt: row.updated_at, lastConsolidatedAt: row.last_consolidated_at,
      lastEventId: row.last_event_id
    };
  }

  itemMap(rows) {
    return Object.fromEntries(rows.map(row => [row.item_key, this.toItem(row, true)]));
  }

  compactSections(rows) {
    const sections = {
      decisionsApproved: {}, technicalContext: {}, technicalContextIndex: {},
      contentsApproved: {}, approvedContentIndex: {}
    };
    rows.forEach(row => {
      const type = String(row.item_type);
      const item = this.toItem(row, true);
      const metadata = this.toItem(row, false);
      if (type === "DECISION") sections.decisionsApproved[row.item_key] = item;
      if (type === "TECHNICAL_CONTEXT") {
        sections.technicalContextIndex[row.item_key] = metadata;
        if (row.value_json !== null) {
          sections.technicalContext[row.item_key] = item;
        }
      }
      if (type === "CONTENT") {
        sections.approvedContentIndex[row.item_key] = metadata;
        if (row.value_json !== null) {
          sections.contentsApproved[row.item_key] = item;
        }
      }
    });
    return sections;
  }

  toItem(row, includeValue) {
    const item = {
      type: String(row.item_type), revision: Number(row.item_revision),
      approvedAt: row.approved_at, updatedAt: row.updated_at,
      sourceEventId: row.source_event_id, size: Number(row.size_bytes)
    };
    if (includeValue) item.value = JSON.parse(row.value_json);
    return item;
  }
}
