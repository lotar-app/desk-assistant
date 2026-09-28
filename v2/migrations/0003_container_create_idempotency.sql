CREATE TABLE mcp_idempotency (
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  response_json TEXT NOT NULL,
  completed_at TEXT NOT NULL,

  PRIMARY KEY (operation, idempotency_key),
  UNIQUE (attempt_id),

  CHECK (length(trim(operation)) > 0),
  CHECK (length(trim(idempotency_key)) BETWEEN 1 AND 64),
  CHECK (length(request_hash) = 64),
  CHECK (length(trim(attempt_id)) > 0),
  CHECK (length(trim(resource_type)) > 0),
  CHECK (length(trim(resource_id)) > 0),
  CHECK (length(trim(response_json)) > 0),
  CHECK (length(trim(completed_at)) > 0)
);

CREATE TRIGGER containers_reject_active_child_of_archived_parent
BEFORE INSERT ON containers
WHEN NEW.parent_id IS NOT NULL
  AND NEW.lifecycle_state = 'ACTIVE'
  AND EXISTS (
    SELECT 1
    FROM containers AS parent
    WHERE parent.container_id = NEW.parent_id
      AND parent.lifecycle_state = 'ARCHIVED'
  )
BEGIN
  SELECT RAISE(ABORT, 'CONTAINER_PARENT_ARCHIVED');
END;
