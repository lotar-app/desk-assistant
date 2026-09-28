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

const CREATE_OPERATION = "desk_v2_create_container";
const MOVE_OPERATION = "desk_v2_move_container";
const RESOURCE_TYPE = "container";
const INITIAL_STATUS = "IN_PROGRESS";
const INITIAL_LIFECYCLE = "ACTIVE";

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

  async createContainer(input) {
    const attemptId = crypto.randomUUID();
    const containerId = `CTR-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const canonicalPayload = JSON.stringify({
      name: input.name,
      parentId: input.parentId,
      focus: input.focus,
      owner: input.owner,
      nextAction: input.nextAction,
      status: INITIAL_STATUS,
      lifecycleState: INITIAL_LIFECYCLE
    });
    const requestHash = await sha256(canonicalPayload);
    const container = {
      containerId,
      parentId: input.parentId,
      name: input.name,
      status: INITIAL_STATUS,
      focus: input.focus,
      owner: input.owner,
      nextAction: input.nextAction,
      lifecycleState: INITIAL_LIFECYCLE,
      version: 1,
      createdAt: now,
      updatedAt: now,
      archivedAt: null
    };
    const responseJson = JSON.stringify({ replayed: false, container });

    const acquire = this.db.prepare(`
      INSERT INTO mcp_idempotency
        (operation, idempotency_key, request_hash, attempt_id, resource_type,
         resource_id, response_json, completed_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE ? IS NULL OR EXISTS (
        SELECT 1 FROM containers
        WHERE container_id = ? AND lifecycle_state = 'ACTIVE'
      )
      ON CONFLICT(operation, idempotency_key) DO NOTHING
    `).bind(
      CREATE_OPERATION, input.idempotencyKey, requestHash, attemptId, RESOURCE_TYPE,
      containerId, responseJson, now, input.parentId, input.parentId
    );
    const insertContainer = this.db.prepare(`
      INSERT INTO containers
        (container_id, parent_id, name, status, focus, owner, next_action,
         lifecycle_state, version, created_at, updated_at, archived_at)
      SELECT resource_id, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL
      FROM mcp_idempotency
      WHERE operation = ? AND idempotency_key = ?
        AND request_hash = ? AND attempt_id = ?
    `).bind(
      input.parentId, input.name, INITIAL_STATUS, input.focus, input.owner,
      input.nextAction, INITIAL_LIFECYCLE, now, now, CREATE_OPERATION,
      input.idempotencyKey, requestHash, attemptId
    );
    const classify = this.db.prepare(`
      SELECT CASE
        WHEN EXISTS (
          SELECT 1 FROM mcp_idempotency
          WHERE operation = ? AND idempotency_key = ? AND request_hash <> ?
        ) THEN 'IDEMPOTENCY_CONFLICT'
        WHEN EXISTS (
          SELECT 1 FROM mcp_idempotency
          WHERE operation = ? AND idempotency_key = ?
            AND request_hash = ? AND attempt_id = ?
        ) THEN 'CREATED'
        WHEN EXISTS (
          SELECT 1 FROM mcp_idempotency
          WHERE operation = ? AND idempotency_key = ? AND request_hash = ?
        ) THEN 'REPLAY'
        WHEN ? IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM containers WHERE container_id = ?
        ) THEN 'PARENT_NOT_FOUND'
        WHEN ? IS NOT NULL AND EXISTS (
          SELECT 1 FROM containers
          WHERE container_id = ? AND lifecycle_state = 'ARCHIVED'
        ) THEN 'PARENT_ARCHIVED'
        ELSE 'UNEXPECTED_STATE'
      END AS outcome,
      (SELECT response_json FROM mcp_idempotency
       WHERE operation = ? AND idempotency_key = ?) AS response_json
    `).bind(
      CREATE_OPERATION, input.idempotencyKey, requestHash,
      CREATE_OPERATION, input.idempotencyKey, requestHash, attemptId,
      CREATE_OPERATION, input.idempotencyKey, requestHash,
      input.parentId, input.parentId, input.parentId, input.parentId,
      CREATE_OPERATION, input.idempotencyKey
    );

    let results;
    try {
      results = await this.db.batch([acquire, insertContainer, classify]);
      if (!Array.isArray(results) || results.some(item => item?.success === false)) {
        throw new Error("D1_BATCH_FAILED");
      }
    } catch {
      throw await this.#classifyBatchFailure(containerId, input.parentId);
    }

    const outcome = results[2]?.results?.[0];
    if (outcome?.outcome === "CREATED") return JSON.parse(outcome.response_json);
    if (outcome?.outcome === "REPLAY") {
      return { ...JSON.parse(outcome.response_json), replayed: true };
    }
    if (outcome?.outcome === "IDEMPOTENCY_CONFLICT") {
      throw domainError("IDEMPOTENCY_KEY_CONFLICT",
        "The idempotency key was already used with a different request.", false);
    }
    if (outcome?.outcome === "PARENT_NOT_FOUND") {
      throw domainError("CONTAINER_PARENT_NOT_FOUND",
        "The requested parent Container does not exist.", false);
    }
    if (outcome?.outcome === "PARENT_ARCHIVED") {
      throw domainError("CONTAINER_PARENT_ARCHIVED",
        "An active Container cannot be created under an archived parent.", false);
    }
    throw domainError("D1_OPERATION_FAILED", "The Container could not be created.", true);
  }

  async moveContainer(input) {
    const canonicalPayload = JSON.stringify({
      containerId: input.containerId,
      newParentId: input.newParentId,
      expectedVersion: input.expectedVersion
    });
    const requestHash = await sha256(canonicalPayload);
    const existing = await this.db.prepare(`
      SELECT request_hash, response_json
      FROM mcp_idempotency
      WHERE operation = ? AND idempotency_key = ?
    `).bind(MOVE_OPERATION, input.idempotencyKey).first();
    if (existing) return replayOrConflict(existing, requestHash);

    const currentRow = await this.#containerRow(input.containerId);
    if (!currentRow) throw moveError("CONTAINER_NOT_FOUND");
    if (currentRow.lifecycle_state === "ARCHIVED") throw moveError("CONTAINER_ARCHIVED");
    if (Number(currentRow.version) !== input.expectedVersion) {
      throw moveError("CONTAINER_VERSION_CONFLICT");
    }
    if (input.newParentId === input.containerId) throw moveError("CONTAINER_SELF_PARENT");
    if (input.newParentId !== null) {
      const parent = await this.#containerRow(input.newParentId);
      if (!parent) throw moveError("CONTAINER_PARENT_NOT_FOUND");
      if (parent.lifecycle_state === "ARCHIVED") {
        throw moveError("CONTAINER_PARENT_ARCHIVED");
      }
      if (await this.#isDescendant(input.containerId, input.newParentId)) {
        throw moveError("CONTAINER_CYCLE");
      }
    }

    const changed = currentRow.parent_id !== input.newParentId;
    const attemptId = crypto.randomUUID();
    const now = new Date().toISOString();
    const container = mapContainer({
      ...currentRow,
      parent_id: input.newParentId,
      version: changed ? Number(currentRow.version) + 1 : Number(currentRow.version),
      updated_at: changed ? now : currentRow.updated_at
    });
    const responseJson = JSON.stringify({ changed, container });

    const acquire = this.db.prepare(`
      INSERT INTO mcp_idempotency
        (operation, idempotency_key, request_hash, attempt_id, resource_type,
         resource_id, response_json, completed_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM containers AS source
        WHERE source.container_id = ?
          AND source.lifecycle_state = 'ACTIVE'
          AND source.version = ?
      )
        AND (? IS NULL OR ? <> ?)
        AND (? IS NULL OR EXISTS (
          SELECT 1 FROM containers AS parent
          WHERE parent.container_id = ? AND parent.lifecycle_state = 'ACTIVE'
        ))
        AND (? IS NULL OR NOT EXISTS (
          WITH RECURSIVE descendants(container_id) AS (
            SELECT container_id FROM containers WHERE parent_id = ?
            UNION ALL
            SELECT child.container_id
            FROM containers AS child
            JOIN descendants AS ancestor ON child.parent_id = ancestor.container_id
          )
          SELECT 1 FROM descendants WHERE container_id = ?
        ))
      ON CONFLICT(operation, idempotency_key) DO NOTHING
    `).bind(
      MOVE_OPERATION, input.idempotencyKey, requestHash, attemptId, RESOURCE_TYPE,
      input.containerId, responseJson, now,
      input.containerId, input.expectedVersion,
      input.newParentId, input.newParentId, input.containerId,
      input.newParentId, input.newParentId,
      input.newParentId, input.containerId, input.newParentId
    );
    const update = this.db.prepare(`
      UPDATE containers
      SET parent_id = ?, version = version + 1, updated_at = ?
      WHERE container_id = ? AND lifecycle_state = 'ACTIVE' AND version = ?
        AND parent_id IS NOT ?
        AND EXISTS (
          SELECT 1 FROM mcp_idempotency
          WHERE operation = ? AND idempotency_key = ? AND request_hash = ?
            AND attempt_id = ?
        )
    `).bind(
      input.newParentId, now, input.containerId, input.expectedVersion,
      input.newParentId, MOVE_OPERATION, input.idempotencyKey, requestHash, attemptId
    );
    const classify = this.#moveClassificationStatement(input, requestHash, attemptId);

    let results;
    try {
      results = await this.db.batch([acquire, update, classify]);
      if (!Array.isArray(results) || results.some(item => item?.success === false)) {
        throw new Error("D1_BATCH_FAILED");
      }
    } catch {
      const failure = await this.#classifyMoveFailure(input, requestHash);
      if (failure instanceof Error) throw failure;
      return failure;
    }

    const outcome = results[2]?.results?.[0];
    return moveOutcome(outcome);
  }

  async #all(sql, values) {
    const statement = this.db.prepare(sql).bind(...values);
    const result = await statement.all();
    return (result.results || []).map(mapContainer);
  }

  async #containerRow(containerId) {
    return this.db.prepare(`
      SELECT ${CONTAINER_COLUMNS}
      FROM containers
      WHERE container_id = ?
    `).bind(containerId).first();
  }

  async #isDescendant(containerId, possibleDescendantId) {
    const result = await this.db.prepare(`
      WITH RECURSIVE descendants(container_id) AS (
        SELECT container_id FROM containers WHERE parent_id = ?
        UNION ALL
        SELECT child.container_id
        FROM containers AS child
        JOIN descendants AS ancestor ON child.parent_id = ancestor.container_id
      )
      SELECT 1 AS found FROM descendants WHERE container_id = ? LIMIT 1
    `).bind(containerId, possibleDescendantId).all();
    return Boolean(result.results?.length);
  }

  #moveClassificationStatement(input, requestHash, attemptId) {
    return this.db.prepare(`
      SELECT CASE
        WHEN EXISTS (
          SELECT 1 FROM mcp_idempotency
          WHERE operation = ? AND idempotency_key = ? AND request_hash <> ?
        ) THEN 'IDEMPOTENCY_CONFLICT'
        WHEN EXISTS (
          SELECT 1 FROM mcp_idempotency
          WHERE operation = ? AND idempotency_key = ? AND request_hash = ?
            AND attempt_id = ?
        ) THEN 'COMPLETED'
        WHEN EXISTS (
          SELECT 1 FROM mcp_idempotency
          WHERE operation = ? AND idempotency_key = ? AND request_hash = ?
        ) THEN 'REPLAY'
        WHEN NOT EXISTS (
          SELECT 1 FROM containers WHERE container_id = ?
        ) THEN 'CONTAINER_NOT_FOUND'
        WHEN EXISTS (
          SELECT 1 FROM containers
          WHERE container_id = ? AND lifecycle_state = 'ARCHIVED'
        ) THEN 'CONTAINER_ARCHIVED'
        WHEN NOT EXISTS (
          SELECT 1 FROM containers WHERE container_id = ? AND version = ?
        ) THEN 'VERSION_CONFLICT'
        WHEN ? IS NOT NULL AND ? = ? THEN 'SELF_PARENT'
        WHEN ? IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM containers WHERE container_id = ?
        ) THEN 'PARENT_NOT_FOUND'
        WHEN ? IS NOT NULL AND EXISTS (
          SELECT 1 FROM containers
          WHERE container_id = ? AND lifecycle_state = 'ARCHIVED'
        ) THEN 'PARENT_ARCHIVED'
        WHEN ? IS NOT NULL AND EXISTS (
          WITH RECURSIVE descendants(container_id) AS (
            SELECT container_id FROM containers WHERE parent_id = ?
            UNION ALL
            SELECT child.container_id
            FROM containers AS child
            JOIN descendants AS ancestor ON child.parent_id = ancestor.container_id
          )
          SELECT 1 FROM descendants WHERE container_id = ?
        ) THEN 'CYCLE'
        ELSE 'UNEXPECTED_STATE'
      END AS outcome,
      (SELECT response_json FROM mcp_idempotency
       WHERE operation = ? AND idempotency_key = ?) AS response_json
    `).bind(
      MOVE_OPERATION, input.idempotencyKey, requestHash,
      MOVE_OPERATION, input.idempotencyKey, requestHash, attemptId,
      MOVE_OPERATION, input.idempotencyKey, requestHash,
      input.containerId,
      input.containerId,
      input.containerId, input.expectedVersion,
      input.newParentId, input.newParentId, input.containerId,
      input.newParentId, input.newParentId,
      input.newParentId, input.newParentId,
      input.newParentId, input.containerId, input.newParentId,
      MOVE_OPERATION, input.idempotencyKey
    );
  }

  async #classifyMoveFailure(input, requestHash) {
    try {
      const existing = await this.db.prepare(`
        SELECT request_hash, response_json
        FROM mcp_idempotency
        WHERE operation = ? AND idempotency_key = ?
      `).bind(MOVE_OPERATION, input.idempotencyKey).first();
      if (existing) return replayOrConflict(existing, requestHash);
      const source = await this.#containerRow(input.containerId);
      if (!source) return moveError("CONTAINER_NOT_FOUND");
      if (source.lifecycle_state === "ARCHIVED") return moveError("CONTAINER_ARCHIVED");
      if (Number(source.version) !== input.expectedVersion) {
        return moveError("CONTAINER_VERSION_CONFLICT");
      }
      if (input.newParentId === input.containerId) return moveError("CONTAINER_SELF_PARENT");
      if (input.newParentId !== null) {
        const parent = await this.#containerRow(input.newParentId);
        if (!parent) return moveError("CONTAINER_PARENT_NOT_FOUND");
        if (parent.lifecycle_state === "ARCHIVED") {
          return moveError("CONTAINER_PARENT_ARCHIVED");
        }
        if (await this.#isDescendant(input.containerId, input.newParentId)) {
          return moveError("CONTAINER_CYCLE");
        }
      }
    } catch (error) {
      if (error instanceof ContainerDomainError) return error;
    }
    return moveError("D1_OPERATION_FAILED");
  }

  async #classifyBatchFailure(containerId, parentId) {
    try {
      const collision = await this.db.prepare(
        "SELECT container_id FROM containers WHERE container_id = ?"
      ).bind(containerId).first();
      if (collision) {
        return domainError("CONTAINER_ID_COLLISION",
          "The generated Container ID collided with an existing Container.", true);
      }
      if (parentId !== null) {
        const parent = await this.db.prepare(
          "SELECT lifecycle_state FROM containers WHERE container_id = ?"
        ).bind(parentId).first();
        if (!parent) {
          return domainError("CONTAINER_PARENT_NOT_FOUND",
            "The requested parent Container does not exist.", false);
        }
        if (parent.lifecycle_state === "ARCHIVED") {
          return domainError("CONTAINER_PARENT_ARCHIVED",
            "An active Container cannot be created under an archived parent.", false);
        }
      }
    } catch {
      // Fall through to the sanitized generic error.
    }
    return domainError("D1_OPERATION_FAILED", "The Container could not be created.", true);
  }
}

export class ContainerDomainError extends Error {
  constructor(code, message, retryable) {
    super(message);
    this.name = "ContainerDomainError";
    this.code = code;
    this.retryable = retryable;
  }
}

function domainError(code, message, retryable) {
  return new ContainerDomainError(code, message, retryable);
}

const MOVE_ERRORS = {
  CONTAINER_NOT_FOUND: ["The Container does not exist.", false],
  CONTAINER_ARCHIVED: ["An archived Container cannot be moved.", false],
  CONTAINER_PARENT_NOT_FOUND: ["The requested parent Container does not exist.", false],
  CONTAINER_PARENT_ARCHIVED: ["An active Container cannot be moved under an archived parent.", false],
  CONTAINER_SELF_PARENT: ["A Container cannot be its own parent.", false],
  CONTAINER_CYCLE: ["The Move would create a Container cycle.", false],
  CONTAINER_VERSION_CONFLICT: ["The Container changed since it was read.", false],
  IDEMPOTENCY_KEY_CONFLICT: ["The idempotency key was already used with a different request.", false],
  D1_OPERATION_FAILED: ["The Container could not be moved.", true]
};

function moveError(code) {
  const [message, retryable] = MOVE_ERRORS[code];
  return domainError(code, message, retryable);
}

function replayOrConflict(existing, requestHash) {
  if (existing.request_hash !== requestHash) throw moveError("IDEMPOTENCY_KEY_CONFLICT");
  return { replayed: true, ...JSON.parse(existing.response_json) };
}

function moveOutcome(outcome) {
  if (outcome?.outcome === "COMPLETED") {
    return { replayed: false, ...JSON.parse(outcome.response_json) };
  }
  if (outcome?.outcome === "REPLAY") {
    return { replayed: true, ...JSON.parse(outcome.response_json) };
  }
  const codes = {
    IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_KEY_CONFLICT",
    CONTAINER_NOT_FOUND: "CONTAINER_NOT_FOUND",
    CONTAINER_ARCHIVED: "CONTAINER_ARCHIVED",
    VERSION_CONFLICT: "CONTAINER_VERSION_CONFLICT",
    SELF_PARENT: "CONTAINER_SELF_PARENT",
    PARENT_NOT_FOUND: "CONTAINER_PARENT_NOT_FOUND",
    PARENT_ARCHIVED: "CONTAINER_PARENT_ARCHIVED",
    CYCLE: "CONTAINER_CYCLE"
  };
  throw moveError(codes[outcome?.outcome] || "D1_OPERATION_FAILED");
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map(byte => byte.toString(16).padStart(2, "0")).join("");
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
