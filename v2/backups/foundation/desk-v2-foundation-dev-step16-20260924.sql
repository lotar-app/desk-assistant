PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE IF NOT EXISTS "d1_migrations"(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(1,'0001_foundation.sql','2026-09-23 10:33:42');
CREATE TABLE system_metadata (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (length(trim(key)) > 0),
  CHECK (length(trim(value)) > 0)
);
INSERT INTO "system_metadata" ("key","value","created_at") VALUES('system_name','desk-v2','2026-09-23T10:33:42.035Z');
INSERT INTO "system_metadata" ("key","value","created_at") VALUES('schema_family','desk-v2-foundation','2026-09-23T10:33:42.035Z');
INSERT INTO "system_metadata" ("key","value","created_at") VALUES('environment','v2-development','2026-09-23T10:33:42.035Z');
CREATE TABLE containers (
  container_id TEXT PRIMARY KEY NOT NULL,
  parent_id TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  focus TEXT,
  owner TEXT,
  next_action TEXT,
  lifecycle_state TEXT NOT NULL DEFAULT 'ACTIVE',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (parent_id) REFERENCES containers(container_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (length(trim(container_id)) > 0),
  CHECK (length(trim(name)) > 0),
  CHECK (parent_id IS NULL OR parent_id <> container_id),
  CHECK (lifecycle_state IN ('ACTIVE', 'ARCHIVED')),
  CHECK (version >= 1),
  CHECK (
    (lifecycle_state = 'ACTIVE' AND archived_at IS NULL) OR
    (lifecycle_state = 'ARCHIVED' AND archived_at IS NOT NULL)
  )
);
CREATE TABLE tasks (
  task_id TEXT PRIMARY KEY NOT NULL,
  container_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  priority TEXT,
  assignee TEXT,
  due_date TEXT,
  lifecycle_state TEXT NOT NULL DEFAULT 'ACTIVE',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  archived_at TEXT,
  FOREIGN KEY (container_id) REFERENCES containers(container_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (length(trim(task_id)) > 0),
  CHECK (length(trim(title)) > 0),
  CHECK (lifecycle_state IN ('ACTIVE', 'ARCHIVED')),
  CHECK (version >= 1),
  CHECK (
    (lifecycle_state = 'ACTIVE' AND archived_at IS NULL) OR
    (lifecycle_state = 'ARCHIVED' AND archived_at IS NOT NULL)
  )
);
DELETE FROM sqlite_sequence;
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('d1_migrations',1);
CREATE INDEX idx_containers_parent_id ON containers(parent_id);
CREATE INDEX idx_containers_lifecycle ON containers(lifecycle_state);
CREATE INDEX idx_containers_parent_name ON containers(parent_id, name);
CREATE INDEX idx_tasks_container_id ON tasks(container_id);
CREATE INDEX idx_tasks_container_lifecycle
  ON tasks(container_id, lifecycle_state);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_due_date ON tasks(due_date);
CREATE TRIGGER containers_prevent_cycle
BEFORE UPDATE OF parent_id ON containers
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT (CASE WHEN EXISTS (
    WITH RECURSIVE descendants(container_id) AS (
      SELECT container_id
      FROM containers
      WHERE parent_id = NEW.container_id
      UNION ALL
      SELECT child.container_id
      FROM containers AS child
      JOIN descendants AS parent
        ON child.parent_id = parent.container_id
    )
    SELECT 1
    FROM descendants
    WHERE container_id = NEW.parent_id
  ) THEN RAISE(ABORT, 'CONTAINER_CYCLE') END);
END;
