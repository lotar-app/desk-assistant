CREATE TABLE IF NOT EXISTS project_activity_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_project_activity_idempotency_activity
  ON project_activity_idempotency(activity_id);
