PRAGMA foreign_keys = ON;

-- STEP 31A only prepares storage for the future hierarchy. Existing rows stay
-- untouched: both columns are nullable and this migration performs no backfill.
ALTER TABLE containers ADD COLUMN name_key TEXT;
ALTER TABLE containers ADD COLUMN role TEXT;

-- Normalization contract for name_key (normalization_version = 1):
--   1. trim leading and trailing whitespace;
--   2. normalize Unicode to NFKC;
--   3. collapse Unicode whitespace sequences to one ASCII space;
--   4. apply locale-independent Unicode case folding;
--   5. reject an empty result.
-- SQLite lower(trim(name)) is deliberately not used because it does not provide
-- complete Unicode case folding. Population and enforcement are deferred.
CREATE INDEX idx_containers_parent_name_key
  ON containers(parent_id, name_key);

CREATE TABLE desk_hierarchy (
  singleton_id INTEGER PRIMARY KEY NOT NULL,
  root_container_id TEXT NOT NULL,
  hierarchy_revision INTEGER NOT NULL DEFAULT 1,
  timezone TEXT NOT NULL,
  normalization_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (root_container_id) REFERENCES containers(container_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (singleton_id = 1),
  CHECK (hierarchy_revision >= 1),
  CHECK (length(trim(timezone)) > 0),
  CHECK (normalization_version >= 1),
  CHECK (length(trim(created_at)) > 0),
  CHECK (length(trim(updated_at)) > 0)
);
