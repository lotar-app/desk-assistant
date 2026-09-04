PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS project_activities (
  activity_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  status TEXT NOT NULL,
  focus TEXT,
  next_action TEXT,
  summary TEXT,
  schema_version INTEGER NOT NULL,
  snapshot_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_consolidated_at TEXT,
  last_event_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_project_activities_project_id
  ON project_activities(project_id);

CREATE TABLE IF NOT EXISTS project_activity_aliases (
  project_id TEXT NOT NULL,
  alias_key TEXT NOT NULL,
  alias TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, alias_key),
  FOREIGN KEY (activity_id) REFERENCES project_activities(activity_id)
);

CREATE INDEX IF NOT EXISTS idx_project_activity_aliases_alias_key
  ON project_activity_aliases(alias_key);

CREATE TABLE IF NOT EXISTS project_activity_items (
  activity_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  item_type TEXT NOT NULL,
  value_json TEXT NOT NULL,
  item_revision INTEGER NOT NULL,
  approved_at TEXT,
  updated_at TEXT NOT NULL,
  source_event_id TEXT,
  PRIMARY KEY (activity_id, item_key),
  FOREIGN KEY (activity_id) REFERENCES project_activities(activity_id)
);

CREATE INDEX IF NOT EXISTS idx_project_activity_items_activity_type
  ON project_activity_items(activity_id, item_type);

CREATE TABLE IF NOT EXISTS project_activity_item_revisions (
  revision_id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  operation TEXT NOT NULL,
  previous_value_json TEXT,
  new_value_json TEXT,
  item_revision INTEGER NOT NULL,
  snapshot_version INTEGER NOT NULL,
  changed_at TEXT NOT NULL,
  source TEXT,
  reason TEXT,
  idempotency_key TEXT NOT NULL,
  FOREIGN KEY (activity_id) REFERENCES project_activities(activity_id)
);

CREATE TABLE IF NOT EXISTS timeline_outbox (
  event_id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  description TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  FOREIGN KEY (activity_id) REFERENCES project_activities(activity_id)
);
