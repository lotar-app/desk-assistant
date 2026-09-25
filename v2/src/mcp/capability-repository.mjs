export class CapabilityRepository {
  constructor(db) {
    this.db = db;
  }

  async readSnapshot() {
    const [containers, tasks] = await Promise.all([
      this.#count("containers"),
      this.#count("tasks")
    ]);
    return {
      service: "desk-v2",
      environment: "v2-development",
      schemaVersion: "0001_foundation",
      containerCount: containers,
      taskCount: tasks
    };
  }

  async createMarker(marker) {
    const insert = await this.db.prepare(
      "INSERT INTO mcp_capability_test (marker) VALUES (?)"
    ).bind(marker).run();
    const id = Number(insert.meta?.last_row_id);
    const row = await this.db.prepare(
      "SELECT id, marker, created_at FROM mcp_capability_test WHERE id = ?"
    ).bind(id).first();
    if (!row) throw new Error("MCP_CAPABILITY_WRITE_NOT_FOUND");
    return { id: Number(row.id), marker: String(row.marker), createdAt: String(row.created_at) };
  }

  async #count(table) {
    const row = await this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first();
    return Number(row?.count || 0);
  }
}
