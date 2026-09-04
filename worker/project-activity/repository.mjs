export class ProjectActivityRepository {
  constructor(db) {
    this.db = db;
  }

  async findById(activityId) {
    return this.db.prepare(`
      SELECT activity_id, project_id, kind, canonical_name, normalized_name,
             status, focus, next_action, summary, schema_version,
             snapshot_version, created_at, updated_at, last_consolidated_at,
             last_event_id
      FROM project_activities
      WHERE activity_id = ?
      LIMIT 1
    `).bind(activityId).first();
  }

  async findByProjectAlias(projectId, aliasKey) {
    return this.db.prepare(`
      SELECT a.activity_id, a.project_id, a.kind, a.canonical_name,
             a.normalized_name, a.status, a.focus, a.next_action, a.summary,
             a.schema_version, a.snapshot_version, a.created_at, a.updated_at,
             a.last_consolidated_at, a.last_event_id
      FROM project_activity_aliases x
      JOIN project_activities a ON a.activity_id = x.activity_id
      WHERE x.project_id = ? AND x.alias_key = ?
      LIMIT 1
    `).bind(projectId, aliasKey).first();
  }

  async findByGlobalAlias(aliasKey) {
    const result = await this.db.prepare(`
      SELECT a.activity_id, a.project_id, a.canonical_name
      FROM project_activity_aliases x
      JOIN project_activities a ON a.activity_id = x.activity_id
      WHERE x.alias_key = ?
      ORDER BY a.project_id, a.activity_id
    `).bind(aliasKey).all();
    return result.results || [];
  }

  async listItems(activityId) {
    const result = await this.db.prepare(`
      SELECT activity_id, item_key, item_type, value_json, item_revision,
             approved_at, updated_at, source_event_id,
             length(CAST(value_json AS BLOB)) AS size_bytes
      FROM project_activity_items
      WHERE activity_id = ?
      ORDER BY item_type, item_key
    `).bind(activityId).all();
    return result.results || [];
  }

  async listCompactItems(activityId, maxBytes) {
    const result = await this.db.prepare(`
      SELECT activity_id, item_key, item_type,
             CASE
               WHEN item_type = 'DECISION'
                 OR length(CAST(value_json AS BLOB)) <= ?
               THEN value_json
               ELSE NULL
             END AS value_json,
             item_revision, approved_at, updated_at, source_event_id,
             length(CAST(value_json AS BLOB)) AS size_bytes
      FROM project_activity_items
      WHERE activity_id = ?
      ORDER BY item_type, item_key
    `).bind(maxBytes, activityId).all();
    return result.results || [];
  }

  async getItemsByKeys(activityId, keys) {
    const placeholders = keys.map(() => "?").join(", ");
    const result = await this.db.prepare(`
      SELECT activity_id, item_key, item_type, value_json, item_revision,
             approved_at, updated_at, source_event_id,
             length(CAST(value_json AS BLOB)) AS size_bytes
      FROM project_activity_items
      WHERE activity_id = ? AND item_key IN (${placeholders})
      ORDER BY item_key
    `).bind(activityId, ...keys).all();
    return result.results || [];
  }
}
