CREATE TABLE mcp_capability_test (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  marker TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (length(trim(marker)) BETWEEN 1 AND 64)
);
