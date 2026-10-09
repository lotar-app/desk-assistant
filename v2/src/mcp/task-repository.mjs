const TASK_COLUMNS = `
  task_id,
  container_id,
  title,
  description,
  status,
  priority,
  assignee,
  due_date,
  lifecycle_state,
  version,
  created_at,
  updated_at,
  completed_at,
  archived_at`;

const CREATE_OPERATION = "desk_v2_create_task";
const UPDATE_OPERATION = "desk_v2_update_task";
const RESOURCE_TYPE = "task";
const INITIAL_LIFECYCLE = "ACTIVE";
const UPDATE_COLUMNS = {
  title: "title",
  description: "description",
  status: "status",
  priority: "priority",
  assignee: "assignee",
  dueDate: "due_date"
};

export class TaskRepository {
  constructor(db) {
    this.db = db;
  }

  async getTasks({ taskId, containerId, lifecycle = "ACTIVE" }) {
    try {
      if (taskId !== undefined) {
        const row = await this.db.prepare(`
          SELECT ${TASK_COLUMNS}
          FROM tasks
          WHERE task_id = ?
        `).bind(taskId).first();
        if (!row) throw taskError("TASK_NOT_FOUND");
        return response("BY_ID", null, null, [row]);
      }

      const container = await this.db.prepare(
        "SELECT container_id FROM containers WHERE container_id = ?"
      ).bind(containerId).first();
      if (!container) throw taskError("CONTAINER_NOT_FOUND");

      const values = [containerId];
      const lifecycleClause = lifecycle === "ALL" ? "" : " AND lifecycle_state = ?";
      if (lifecycle !== "ALL") values.push(lifecycle);
      const result = await this.db.prepare(`
        SELECT ${TASK_COLUMNS}
        FROM tasks
        WHERE container_id = ?${lifecycleClause}
        ORDER BY title ASC, task_id ASC
      `).bind(...values).all();
      return response("CONTAINER", containerId, lifecycle, result.results || []);
    } catch (error) {
      if (error instanceof TaskDomainError) throw error;
      throw taskError("D1_OPERATION_FAILED");
    }
  }

  async createTask(input) {
    const attemptId = crypto.randomUUID();
    const taskId = `TSK-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const canonicalPayload = JSON.stringify({
      containerId: input.containerId,
      title: input.title,
      status: input.status,
      description: input.description,
      priority: input.priority,
      assignee: input.assignee,
      dueDate: input.dueDate,
      lifecycleState: INITIAL_LIFECYCLE,
      completedAt: null
    });
    const requestHash = await sha256(canonicalPayload);
    const task = {
      taskId,
      containerId: input.containerId,
      title: input.title,
      description: input.description,
      status: input.status,
      priority: input.priority,
      assignee: input.assignee,
      dueDate: input.dueDate,
      lifecycleState: INITIAL_LIFECYCLE,
      version: 1,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      archivedAt: null
    };
    const responseJson = JSON.stringify({ replayed: false, task });

    const acquire = this.db.prepare(`
      INSERT INTO mcp_idempotency
        (operation, idempotency_key, request_hash, attempt_id, resource_type,
         resource_id, response_json, completed_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM containers
        WHERE container_id = ? AND lifecycle_state = 'ACTIVE'
      )
      ON CONFLICT(operation, idempotency_key) DO NOTHING
    `).bind(
      CREATE_OPERATION, input.idempotencyKey, requestHash, attemptId, RESOURCE_TYPE,
      taskId, responseJson, now, input.containerId
    );
    const insertTask = this.db.prepare(`
      INSERT INTO tasks
        (task_id, container_id, title, description, status, priority, assignee, due_date,
         lifecycle_state, version, created_at, updated_at, completed_at, archived_at)
      SELECT resource_id, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL, NULL
      FROM mcp_idempotency
      WHERE operation = ? AND idempotency_key = ?
        AND request_hash = ? AND attempt_id = ?
    `).bind(
      input.containerId, input.title, input.description, input.status, input.priority,
      input.assignee, input.dueDate, INITIAL_LIFECYCLE, now, now, CREATE_OPERATION,
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
        WHEN NOT EXISTS (
          SELECT 1 FROM containers WHERE container_id = ?
        ) THEN 'CONTAINER_NOT_FOUND'
        WHEN EXISTS (
          SELECT 1 FROM containers
          WHERE container_id = ? AND lifecycle_state = 'ARCHIVED'
        ) THEN 'CONTAINER_ARCHIVED'
        ELSE 'UNEXPECTED_STATE'
      END AS outcome,
      (SELECT response_json FROM mcp_idempotency
       WHERE operation = ? AND idempotency_key = ?) AS response_json
    `).bind(
      CREATE_OPERATION, input.idempotencyKey, requestHash,
      CREATE_OPERATION, input.idempotencyKey, requestHash, attemptId,
      CREATE_OPERATION, input.idempotencyKey, requestHash,
      input.containerId, input.containerId,
      CREATE_OPERATION, input.idempotencyKey
    );

    let results;
    try {
      results = await this.db.batch([acquire, insertTask, classify]);
      if (!Array.isArray(results) || results.some(item => item?.success === false)) {
        throw new Error("D1_BATCH_FAILED");
      }
    } catch {
      throw taskError("D1_OPERATION_FAILED", "The Task could not be created.");
    }

    const outcome = results[2]?.results?.[0];
    if (outcome?.outcome === "CREATED") return JSON.parse(outcome.response_json);
    if (outcome?.outcome === "REPLAY") {
      return { ...JSON.parse(outcome.response_json), replayed: true };
    }
    if (outcome?.outcome === "IDEMPOTENCY_CONFLICT") {
      throw taskError("IDEMPOTENCY_KEY_CONFLICT");
    }
    if (outcome?.outcome === "CONTAINER_NOT_FOUND") throw taskError("CONTAINER_NOT_FOUND");
    if (outcome?.outcome === "CONTAINER_ARCHIVED") throw taskError("CONTAINER_ARCHIVED");
    throw taskError("D1_OPERATION_FAILED", "The Task could not be created.");
  }

  async updateTask(input) {
    const patch = canonicalUpdatePatch(input.patch);
    const canonicalPayload = JSON.stringify({
      taskId: input.taskId,
      expectedVersion: input.expectedVersion,
      patch
    });
    const requestHash = await sha256(canonicalPayload);
    const existing = await this.db.prepare(`
      SELECT request_hash, response_json
      FROM mcp_idempotency
      WHERE operation = ? AND idempotency_key = ?
    `).bind(UPDATE_OPERATION, input.idempotencyKey).first();
    if (existing) return replayOrConflict(existing, requestHash);

    const currentRow = await this.#taskWithContainer(input.taskId);
    validateUpdateSource(currentRow, input.expectedVersion);

    const resultingRow = { ...currentRow };
    for (const [field, column] of Object.entries(UPDATE_COLUMNS)) {
      if (Object.hasOwn(patch, field)) resultingRow[column] = patch[field];
    }
    const changed = Object.entries(UPDATE_COLUMNS).some(([field, column]) =>
      Object.hasOwn(patch, field) && currentRow[column] !== patch[field]);
    const attemptId = crypto.randomUUID();
    const now = new Date().toISOString();
    if (changed) {
      resultingRow.version = Number(currentRow.version) + 1;
      resultingRow.updated_at = now;
    }
    const task = mapTask(resultingRow);
    const responseJson = JSON.stringify({ changed, task });

    const acquire = this.db.prepare(`
      INSERT INTO mcp_idempotency
        (operation, idempotency_key, request_hash, attempt_id, resource_type,
         resource_id, response_json, completed_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1
        FROM tasks AS task
        JOIN containers AS container ON container.container_id = task.container_id
        WHERE task.task_id = ?
          AND task.lifecycle_state = 'ACTIVE'
          AND container.lifecycle_state = 'ACTIVE'
          AND task.version = ?
      )
      ON CONFLICT(operation, idempotency_key) DO NOTHING
    `).bind(
      UPDATE_OPERATION, input.idempotencyKey, requestHash, attemptId, RESOURCE_TYPE,
      input.taskId, responseJson, now, input.taskId, input.expectedVersion
    );
    const assignments = Object.keys(patch).map(field => `${UPDATE_COLUMNS[field]} = ?`);
    const update = this.db.prepare(`
      UPDATE tasks
      SET ${assignments.join(", ")}, version = version + 1, updated_at = ?
      WHERE task_id = ? AND lifecycle_state = 'ACTIVE' AND version = ?
        AND ? = 1
        AND EXISTS (
          SELECT 1 FROM containers
          WHERE container_id = tasks.container_id AND lifecycle_state = 'ACTIVE'
        )
        AND EXISTS (
          SELECT 1 FROM mcp_idempotency
          WHERE operation = ? AND idempotency_key = ? AND request_hash = ?
            AND attempt_id = ?
        )
    `).bind(
      ...Object.keys(patch).map(field => patch[field]), now, input.taskId,
      input.expectedVersion, changed ? 1 : 0, UPDATE_OPERATION,
      input.idempotencyKey, requestHash, attemptId
    );
    const classify = this.#updateClassification(input, requestHash, attemptId);

    let results;
    try {
      results = await this.db.batch([acquire, update, classify]);
      if (!Array.isArray(results) || results.some(item => item?.success === false)) {
        throw new Error("D1_BATCH_FAILED");
      }
    } catch {
      const failure = await this.#classifyUpdateFailure(input, requestHash);
      if (failure instanceof Error) throw failure;
      return failure;
    }
    return updateOutcome(results[2]?.results?.[0]);
  }

  async #taskWithContainer(taskId) {
    return this.db.prepare(`
      SELECT
        task.task_id AS task_id,
        task.container_id AS container_id,
        task.title AS title,
        task.description AS description,
        task.status AS status,
        task.priority AS priority,
        task.assignee AS assignee,
        task.due_date AS due_date,
        task.lifecycle_state AS lifecycle_state,
        task.version AS version,
        task.created_at AS created_at,
        task.updated_at AS updated_at,
        task.completed_at AS completed_at,
        task.archived_at AS archived_at,
        container.lifecycle_state AS container_lifecycle_state
      FROM tasks AS task
      JOIN containers AS container ON container.container_id = task.container_id
      WHERE task.task_id = ?
    `).bind(taskId).first();
  }

  #updateClassification(input, requestHash, attemptId) {
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
        WHEN NOT EXISTS (SELECT 1 FROM tasks WHERE task_id = ?) THEN 'TASK_NOT_FOUND'
        WHEN EXISTS (
          SELECT 1 FROM tasks WHERE task_id = ? AND lifecycle_state = 'ARCHIVED'
        ) THEN 'TASK_ARCHIVED'
        WHEN EXISTS (
          SELECT 1 FROM tasks AS task
          JOIN containers AS container ON container.container_id = task.container_id
          WHERE task.task_id = ? AND container.lifecycle_state = 'ARCHIVED'
        ) THEN 'CONTAINER_ARCHIVED'
        WHEN NOT EXISTS (
          SELECT 1 FROM tasks WHERE task_id = ? AND version = ?
        ) THEN 'VERSION_CONFLICT'
        ELSE 'UNEXPECTED_STATE'
      END AS outcome,
      (SELECT response_json FROM mcp_idempotency
       WHERE operation = ? AND idempotency_key = ?) AS response_json
    `).bind(
      UPDATE_OPERATION, input.idempotencyKey, requestHash,
      UPDATE_OPERATION, input.idempotencyKey, requestHash, attemptId,
      UPDATE_OPERATION, input.idempotencyKey, requestHash,
      input.taskId, input.taskId, input.taskId, input.taskId, input.expectedVersion,
      UPDATE_OPERATION, input.idempotencyKey
    );
  }

  async #classifyUpdateFailure(input, requestHash) {
    try {
      const existing = await this.db.prepare(`
        SELECT request_hash, response_json
        FROM mcp_idempotency
        WHERE operation = ? AND idempotency_key = ?
      `).bind(UPDATE_OPERATION, input.idempotencyKey).first();
      if (existing) return replayOrConflict(existing, requestHash);
      const currentRow = await this.#taskWithContainer(input.taskId);
      validateUpdateSource(currentRow, input.expectedVersion);
    } catch (error) {
      if (error instanceof TaskDomainError) return error;
    }
    return taskError("D1_OPERATION_FAILED", "The Task could not be updated.");
  }
}

export class TaskDomainError extends Error {
  constructor(code, message, retryable) {
    super(message);
    this.name = "TaskDomainError";
    this.code = code;
    this.retryable = retryable;
  }
}

const TASK_ERRORS = {
  TASK_NOT_FOUND: ["The Task does not exist.", false],
  TASK_ARCHIVED: ["An archived Task cannot be updated.", false],
  TASK_VERSION_CONFLICT: ["The Task changed since it was read.", false],
  CONTAINER_NOT_FOUND: ["The Container does not exist.", false],
  CONTAINER_ARCHIVED: ["A Task cannot be created in an archived Container.", false],
  IDEMPOTENCY_KEY_CONFLICT: [
    "The idempotency key was already used with a different request.", false
  ],
  D1_OPERATION_FAILED: ["The Tasks could not be read.", true]
};

function taskError(code, overrideMessage) {
  const [defaultMessage, retryable] = TASK_ERRORS[code];
  const message = overrideMessage || defaultMessage;
  return new TaskDomainError(code, message, retryable);
}

function response(scope, containerId, lifecycle, rows) {
  const tasks = rows.map(mapTask);
  return { scope, containerId, lifecycle, count: tasks.length, tasks };
}

function mapTask(row) {
  return {
    taskId: row.task_id,
    containerId: row.container_id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    assignee: row.assignee,
    dueDate: row.due_date,
    lifecycleState: row.lifecycle_state,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    archivedAt: row.archived_at
  };
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalUpdatePatch(patch) {
  const canonical = {};
  for (const field of Object.keys(UPDATE_COLUMNS)) {
    if (Object.hasOwn(patch, field)) canonical[field] = patch[field];
  }
  return canonical;
}

function replayOrConflict(existing, requestHash) {
  if (existing.request_hash !== requestHash) throw taskError("IDEMPOTENCY_KEY_CONFLICT");
  return { replayed: true, ...JSON.parse(existing.response_json) };
}

function validateUpdateSource(row, expectedVersion) {
  if (!row) throw taskError("TASK_NOT_FOUND");
  if (row.lifecycle_state === "ARCHIVED") throw taskError("TASK_ARCHIVED");
  if (row.container_lifecycle_state === "ARCHIVED") throw taskError("CONTAINER_ARCHIVED");
  if (Number(row.version) !== expectedVersion) throw taskError("TASK_VERSION_CONFLICT");
}

function updateOutcome(outcome) {
  if (outcome?.outcome === "COMPLETED") {
    return { replayed: false, ...JSON.parse(outcome.response_json) };
  }
  if (outcome?.outcome === "REPLAY") {
    return { replayed: true, ...JSON.parse(outcome.response_json) };
  }
  const codes = {
    IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_KEY_CONFLICT",
    TASK_NOT_FOUND: "TASK_NOT_FOUND",
    TASK_ARCHIVED: "TASK_ARCHIVED",
    CONTAINER_ARCHIVED: "CONTAINER_ARCHIVED",
    VERSION_CONFLICT: "TASK_VERSION_CONFLICT"
  };
  throw taskError(codes[outcome?.outcome] || "D1_OPERATION_FAILED");
}
