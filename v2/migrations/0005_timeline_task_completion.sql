PRAGMA foreign_keys = ON;

CREATE TABLE timeline_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  container_id TEXT NOT NULL,
  task_id TEXT,
  event_type TEXT NOT NULL,
  description TEXT NOT NULL,
  origin TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  idempotency_operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  FOREIGN KEY (container_id) REFERENCES containers(container_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (task_id) REFERENCES tasks(task_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (idempotency_operation, idempotency_key)
    REFERENCES mcp_idempotency(operation, idempotency_key)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  UNIQUE (idempotency_operation, idempotency_key),
  CHECK (length(trim(event_id)) > 0),
  CHECK (length(trim(event_type)) > 0),
  CHECK (length(trim(description)) > 0),
  CHECK (length(trim(origin)) > 0),
  CHECK (length(trim(occurred_at)) > 0)
);

CREATE INDEX idx_timeline_container_order
  ON timeline_events(container_id, occurred_at DESC, event_id DESC);
CREATE INDEX idx_timeline_task_order
  ON timeline_events(task_id, occurred_at DESC, event_id DESC);

CREATE TRIGGER timeline_events_task_container_match
BEFORE INSERT ON timeline_events
WHEN NEW.task_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM tasks
    WHERE task_id = NEW.task_id AND container_id = NEW.container_id
  )
BEGIN
  SELECT RAISE(ABORT, 'TIMELINE_TASK_CONTAINER_MISMATCH');
END;

CREATE TRIGGER timeline_events_append_only_update
BEFORE UPDATE ON timeline_events
BEGIN
  SELECT RAISE(ABORT, 'TIMELINE_APPEND_ONLY');
END;

CREATE TRIGGER timeline_events_append_only_delete
BEFORE DELETE ON timeline_events
BEGIN
  SELECT RAISE(ABORT, 'TIMELINE_APPEND_ONLY');
END;
