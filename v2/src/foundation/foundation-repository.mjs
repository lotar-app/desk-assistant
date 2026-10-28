const EXPECTED_TABLES = Object.freeze([
  "containers",
  "d1_migrations",
  "desk_hierarchy",
  "mcp_capability_test",
  "mcp_idempotency",
  "project_activities",
  "project_activity_aliases",
  "project_activity_item_revisions",
  "project_activity_items",
  "system_metadata",
  "tasks",
  "timeline_events"
]);

const EXPECTED_CONTAINER_COLUMNS = Object.freeze(["name_key", "role"]);

export class FoundationRepository {
  constructor(db) {
    this.db = db;
  }

  async readMetadata() {
    const result = await this.db.prepare(
      "SELECT key, value FROM system_metadata ORDER BY key"
    ).all();
    return Object.fromEntries((result.results || []).map(row => [row.key, row.value]));
  }

  async readMigrationNames() {
    const result = await this.db.prepare(
      "SELECT name FROM d1_migrations ORDER BY id"
    ).all();
    return (result.results || []).map(row => String(row.name));
  }

  async readTables() {
    const result = await this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all();
    return (result.results || []).map(row => String(row.name));
  }

  async readContainerColumns() {
    const result = await this.db.prepare("PRAGMA table_info(containers)").all();
    return (result.results || []).map(row => String(row.name));
  }

  async foreignKeysEnabled() {
    const result = await this.db.prepare("PRAGMA foreign_keys").all();
    const row = (result.results || [])[0] || {};
    return Number(row.foreign_keys) === 1;
  }

  expectedTablesPresent(tables) {
    return EXPECTED_TABLES.every(table => tables.includes(table));
  }

  expectedContainerColumnsPresent(columns) {
    return EXPECTED_CONTAINER_COLUMNS.every(column => columns.includes(column));
  }
}
