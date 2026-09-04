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

  async findIdempotency(idempotencyKey) {
    return this.db.prepare(`
      SELECT idempotency_key, activity_id, request_hash, response_json, created_at
      FROM project_activity_idempotency
      WHERE idempotency_key = ?
      LIMIT 1
    `).bind(idempotencyKey).first();
  }

  async findAlias(projectId, aliasKey) {
    return this.db.prepare(`
      SELECT project_id, alias_key, alias, activity_id, created_at
      FROM project_activity_aliases
      WHERE project_id = ? AND alias_key = ?
      LIMIT 1
    `).bind(projectId, aliasKey).first();
  }

  async findOutboxEvent(eventId) {
    return this.db.prepare(`
      SELECT event_id, activity_id, project_id, event_type, description,
             payload_json, created_at, delivered_at, attempts, last_error
      FROM timeline_outbox
      WHERE event_id = ?
      LIMIT 1
    `).bind(eventId).first();
  }

  async listPendingOutbox(limit) {
    const result = await this.db.prepare(`
      SELECT event_id, activity_id, project_id, event_type, description,
             payload_json, created_at, delivered_at, attempts, last_error
      FROM timeline_outbox
      WHERE delivered_at IS NULL
      ORDER BY created_at, event_id
      LIMIT ?
    `).bind(limit).all();
    return result.results || [];
  }

  async recordOutboxSuccess(eventId, deliveredAt) {
    return this.db.prepare(`
      UPDATE timeline_outbox
      SET delivered_at = COALESCE(delivered_at, ?),
          attempts = attempts + 1,
          last_error = NULL
      WHERE event_id = ?
    `).bind(deliveredAt, eventId).run();
  }

  async recordOutboxFailure(eventId, message) {
    return this.db.prepare(`
      UPDATE timeline_outbox
      SET attempts = attempts + 1,
          last_error = CASE WHEN delivered_at IS NULL THEN ? ELSE last_error END
      WHERE event_id = ?
    `).bind(message, eventId).run();
  }

  async commitWrite(plan) {
    const statements = [];
    const idempotencySql = plan.created
      ? `INSERT INTO project_activity_idempotency
           (idempotency_key, activity_id, request_hash, response_json, created_at)
         VALUES (?, ?, ?, ?, ?)`
      : `INSERT INTO project_activity_idempotency
           (idempotency_key, activity_id, request_hash, response_json, created_at)
         VALUES (?,
           (SELECT activity_id FROM project_activities
            WHERE activity_id = ? AND snapshot_version = ?), ?, ?, ?)`;
    const idempotencyBindings = plan.created
      ? [plan.idempotencyKey, plan.activity.activity_id, plan.requestHash,
        JSON.stringify(plan.response), plan.now]
      : [plan.idempotencyKey, plan.activity.activity_id, plan.expectedSnapshotVersion,
        plan.requestHash, JSON.stringify(plan.response), plan.now];
    statements.push(this.db.prepare(idempotencySql).bind(...idempotencyBindings));

    if (plan.created) {
      statements.push(this.db.prepare(`
        INSERT INTO project_activities
          (activity_id, project_id, kind, canonical_name, normalized_name,
           status, focus, next_action, summary, schema_version, snapshot_version,
           created_at, updated_at, last_consolidated_at, last_event_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(...activityBindings(plan.activity)));
    } else if (!plan.noOp) {
      statements.push(this.db.prepare(`
        UPDATE project_activities
        SET status = ?, focus = ?, next_action = ?, summary = ?,
            snapshot_version = ?, updated_at = ?, last_consolidated_at = ?,
            last_event_id = ?
        WHERE activity_id = ? AND snapshot_version = ?
      `).bind(
        plan.activity.status, plan.activity.focus, plan.activity.next_action,
        plan.activity.summary, plan.activity.snapshot_version,
        plan.activity.updated_at, plan.activity.last_consolidated_at,
        plan.activity.last_event_id, plan.activity.activity_id,
        plan.expectedSnapshotVersion
      ));
    }

    plan.aliasAdds.forEach(alias => statements.push(this.db.prepare(`
      INSERT INTO project_activity_aliases
        (project_id, alias_key, alias, activity_id, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(alias.projectId, alias.aliasKey, alias.alias,
      plan.activity.activity_id, plan.now)));
    plan.aliasRemoves.forEach(alias => statements.push(this.db.prepare(`
      DELETE FROM project_activity_aliases
      WHERE project_id = ? AND alias_key = ? AND activity_id = ?
    `).bind(alias.projectId, alias.aliasKey, plan.activity.activity_id)));

    plan.itemUpserts.forEach(item => statements.push(this.db.prepare(`
      INSERT INTO project_activity_items
        (activity_id, item_key, item_type, value_json, item_revision,
         approved_at, updated_at, source_event_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(activity_id, item_key) DO UPDATE SET
        item_type = excluded.item_type, value_json = excluded.value_json,
        item_revision = excluded.item_revision, approved_at = excluded.approved_at,
        updated_at = excluded.updated_at, source_event_id = excluded.source_event_id
    `).bind(plan.activity.activity_id, item.key, item.type, item.valueJson,
      item.revision, item.approvedAt, plan.now, null)));
    plan.itemDeletes.forEach(item => statements.push(this.db.prepare(`
      DELETE FROM project_activity_items
      WHERE activity_id = ? AND item_key = ?
    `).bind(plan.activity.activity_id, item.key)));
    plan.revisions.forEach(revision => statements.push(this.db.prepare(`
      INSERT INTO project_activity_item_revisions
        (revision_id, activity_id, item_key, operation, previous_value_json,
         new_value_json, item_revision, snapshot_version, changed_at, source,
         reason, idempotency_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(revision.revisionId, plan.activity.activity_id, revision.key,
      revision.operation, revision.previousValueJson, revision.newValueJson,
      revision.itemRevision, plan.activity.snapshot_version, plan.now,
      plan.source, revision.reason, plan.idempotencyKey)));
    if (plan.outbox) {
      statements.push(this.db.prepare(`
        INSERT INTO timeline_outbox
          (event_id, activity_id, project_id, event_type, description,
           payload_json, created_at, delivered_at, attempts, last_error)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL)
      `).bind(plan.outbox.eventId, plan.activity.activity_id,
        plan.activity.project_id, plan.outbox.eventType, plan.outbox.description,
        JSON.stringify(plan.outbox.payload), plan.now));
    }
    return this.db.batch(statements);
  }
}

function activityBindings(activity) {
  return [activity.activity_id, activity.project_id, activity.kind,
    activity.canonical_name, activity.normalized_name, activity.status,
    activity.focus, activity.next_action, activity.summary,
    activity.schema_version, activity.snapshot_version, activity.created_at,
    activity.updated_at, activity.last_consolidated_at, activity.last_event_id];
}
