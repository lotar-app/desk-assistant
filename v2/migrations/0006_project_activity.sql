PRAGMA foreign_keys = ON;

CREATE TABLE project_activities (
  activity_id TEXT PRIMARY KEY NOT NULL,
  container_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  focus TEXT,
  next_action TEXT,
  summary TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1,
  snapshot_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_consolidated_at TEXT NOT NULL,
  last_event_id TEXT,
  FOREIGN KEY (container_id) REFERENCES containers(container_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (length(trim(activity_id)) > 0),
  CHECK (length(trim(kind)) > 0),
  CHECK (length(trim(canonical_name)) > 0),
  CHECK (length(trim(normalized_name)) > 0),
  CHECK (schema_version >= 1),
  CHECK (snapshot_version >= 1)
);

CREATE INDEX idx_project_activities_container
  ON project_activities(container_id, activity_id);

CREATE TABLE project_activity_aliases (
  container_id TEXT NOT NULL,
  alias_key TEXT NOT NULL,
  alias TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (container_id, alias_key),
  FOREIGN KEY (container_id) REFERENCES containers(container_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (activity_id) REFERENCES project_activities(activity_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (length(trim(alias_key)) > 0),
  CHECK (length(trim(alias)) > 0)
);

CREATE INDEX idx_project_activity_alias_global
  ON project_activity_aliases(alias_key, container_id, activity_id);

CREATE TABLE project_activity_items (
  activity_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  item_type TEXT NOT NULL,
  value_json TEXT NOT NULL,
  item_revision INTEGER NOT NULL,
  approved_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  source_event_id TEXT,
  PRIMARY KEY (activity_id, item_key),
  FOREIGN KEY (activity_id) REFERENCES project_activities(activity_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (length(trim(item_key)) > 0),
  CHECK (item_type IN ('DECISION', 'CONTENT', 'TECHNICAL_CONTEXT')),
  CHECK (item_revision >= 1)
);

CREATE INDEX idx_project_activity_items_type
  ON project_activity_items(activity_id, item_type, item_key);

CREATE TABLE project_activity_item_revisions (
  revision_id TEXT PRIMARY KEY NOT NULL,
  activity_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  operation TEXT NOT NULL,
  previous_value_json TEXT,
  new_value_json TEXT,
  item_revision INTEGER NOT NULL,
  snapshot_version INTEGER NOT NULL,
  changed_at TEXT NOT NULL,
  source TEXT NOT NULL,
  reason TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  FOREIGN KEY (activity_id) REFERENCES project_activities(activity_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (operation IN ('UPSERT', 'DELETE')),
  CHECK (item_revision >= 1),
  CHECK (snapshot_version >= 1)
);

CREATE INDEX idx_project_activity_revisions
  ON project_activity_item_revisions(activity_id, item_key, item_revision);

CREATE TRIGGER project_activity_revisions_append_only_update
BEFORE UPDATE ON project_activity_item_revisions
BEGIN
  SELECT RAISE(ABORT, 'PROJECT_ACTIVITY_REVISION_APPEND_ONLY');
END;

CREATE TRIGGER project_activity_revisions_append_only_delete
BEFORE DELETE ON project_activity_item_revisions
BEGIN
  SELECT RAISE(ABORT, 'PROJECT_ACTIVITY_REVISION_APPEND_ONLY');
END;

CREATE TRIGGER project_activity_alias_scope_match
BEFORE INSERT ON project_activity_aliases
WHEN NOT EXISTS (
  SELECT 1 FROM project_activities
  WHERE activity_id = NEW.activity_id AND container_id = NEW.container_id
)
BEGIN
  SELECT RAISE(ABORT, 'PROJECT_ACTIVITY_ALIAS_SCOPE_MISMATCH');
END;
