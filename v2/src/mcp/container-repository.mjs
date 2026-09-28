const CONTAINER_COLUMNS = `
  container_id,
  parent_id,
  name,
  status,
  focus,
  owner,
  next_action,
  lifecycle_state,
  version,
  created_at,
  updated_at,
  archived_at`;

export class ContainerRepository {
  constructor(db) {
    this.db = db;
  }

  async getContainers({ containerId, parentId, lifecycle = "ACTIVE" }) {
    if (containerId !== undefined) {
      const rows = await this.#all(
        `SELECT ${CONTAINER_COLUMNS}
         FROM containers
         WHERE container_id = ?`,
        [containerId]
      );
      return response("BY_ID", null, null, rows);
    }

    const scope = parentId === undefined ? "ROOTS" : "CHILDREN";
    const parentClause = parentId === undefined ? "parent_id IS NULL" : "parent_id = ?";
    const values = parentId === undefined ? [] : [parentId];
    const lifecycleClause = lifecycle === "ALL" ? "" : " AND lifecycle_state = ?";
    if (lifecycle !== "ALL") values.push(lifecycle);

    const rows = await this.#all(
      `SELECT ${CONTAINER_COLUMNS}
       FROM containers
       WHERE ${parentClause}${lifecycleClause}
       ORDER BY name ASC, container_id ASC`,
      values
    );
    return response(scope, parentId ?? null, lifecycle, rows);
  }

  async #all(sql, values) {
    const statement = this.db.prepare(sql).bind(...values);
    const result = await statement.all();
    return (result.results || []).map(mapContainer);
  }
}

function response(scope, parentId, lifecycle, containers) {
  return {
    scope,
    parentId,
    lifecycle,
    count: containers.length,
    containers
  };
}

function mapContainer(row) {
  return {
    containerId: row.container_id,
    parentId: row.parent_id,
    name: row.name,
    status: row.status,
    focus: row.focus,
    owner: row.owner,
    nextAction: row.next_action,
    lifecycleState: row.lifecycle_state,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  };
}
