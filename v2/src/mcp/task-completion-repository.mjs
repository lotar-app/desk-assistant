const OPERATION = "desk_v2_set_task_completion";
const RESOURCE_TYPE = "task";
const ORIGIN = "desk_v2_set_task_completion";
const TASK_COLUMNS = `
  task.task_id,
  task.container_id,
  task.title,
  task.description,
  task.status,
  task.priority,
  task.assignee,
  task.due_date,
  task.lifecycle_state,
  task.version,
  task.created_at,
  task.updated_at,
  task.completed_at,
  task.archived_at,
  container.lifecycle_state AS container_lifecycle_state`;

export class TaskCompletionRepository {
  constructor(db) {
    this.db = db;
  }

  async setTaskCompletion(input) {
    const canonicalPayload = JSON.stringify({
      taskId: input.taskId,
      expectedVersion: input.expectedVersion,
      transition: input.transition
    });
    const requestHash = await sha256(canonicalPayload);
    const existing = await this.db.prepare(`
      SELECT request_hash, response_json
      FROM mcp_idempotency
      WHERE operation = ? AND idempotency_key = ?
    `).bind(OPERATION, input.idempotencyKey).first();
    if (existing) return replayOrConflict(existing, requestHash);

    const current = await this.#taskWithContainer(input.taskId);
    validateCurrent(current, input.expectedVersion);

    const now = new Date().toISOString();
    const projection = projectTaskCompletion(current, input.transition, now);
    const { changed, task } = projection;
    const event = changed ? {
      eventId: `EVT-${crypto.randomUUID()}`,
      containerId: current.container_id,
      taskId: current.task_id,
      type: projection.eventType,
      description: projection.eventDescription,
      origin: ORIGIN,
      occurredAt: now,
      idempotencyOperation: OPERATION,
      idempotencyKey: input.idempotencyKey
    } : null;
    const responseJson = JSON.stringify({
      replayed: false,
      changed,
      task,
      timelineEvent: event
    });
    const attemptId = crypto.randomUUID();

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
      OPERATION, input.idempotencyKey, requestHash, attemptId, RESOURCE_TYPE,
      input.taskId, responseJson, now, input.taskId, input.expectedVersion
    );
    const update = this.db.prepare(`
      UPDATE tasks
      SET status = ?, completed_at = ?, version = version + 1, updated_at = ?
      WHERE task_id = ? AND lifecycle_state = 'ACTIVE' AND version = ?
        AND ((? = 'COMPLETE' AND completed_at IS NULL)
          OR (? = 'REOPEN' AND completed_at IS NOT NULL))
        AND EXISTS (
          SELECT 1 FROM mcp_idempotency
          WHERE operation = ? AND idempotency_key = ? AND request_hash = ?
            AND attempt_id = ?
        )
    `).bind(
      task.status, task.completedAt, now,
      input.taskId, input.expectedVersion, input.transition, input.transition,
      OPERATION, input.idempotencyKey, requestHash, attemptId
    );
    const appendEvent = this.db.prepare(`
      INSERT INTO timeline_events
        (event_id, container_id, task_id, event_type, description, origin,
         occurred_at, idempotency_operation, idempotency_key)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE ? = 1 AND EXISTS (
        SELECT 1 FROM mcp_idempotency
        WHERE operation = ? AND idempotency_key = ? AND request_hash = ?
          AND attempt_id = ?
      )
    `).bind(
      event?.eventId ?? `NOOP-${attemptId}`, current.container_id, current.task_id,
      event?.type ?? "TASK_NOOP", event?.description ?? "No transition.", ORIGIN, now,
      OPERATION, input.idempotencyKey, changed ? 1 : 0,
      OPERATION, input.idempotencyKey, requestHash, attemptId
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
        ) THEN 'COMPLETED'
        WHEN EXISTS (
          SELECT 1 FROM mcp_idempotency
          WHERE operation = ? AND idempotency_key = ? AND request_hash = ?
        ) THEN 'REPLAY'
        WHEN NOT EXISTS (SELECT 1 FROM tasks WHERE task_id = ?) THEN 'TASK_NOT_FOUND'
        WHEN EXISTS (SELECT 1 FROM tasks WHERE task_id = ? AND lifecycle_state = 'ARCHIVED')
          THEN 'TASK_ARCHIVED'
        WHEN EXISTS (
          SELECT 1 FROM tasks AS task
          JOIN containers AS container ON container.container_id = task.container_id
          WHERE task.task_id = ? AND container.lifecycle_state = 'ARCHIVED'
        ) THEN 'CONTAINER_ARCHIVED'
        WHEN EXISTS (SELECT 1 FROM tasks WHERE task_id = ? AND version <> ?)
          THEN 'TASK_VERSION_CONFLICT'
        ELSE 'UNEXPECTED_STATE'
      END AS outcome,
      (SELECT response_json FROM mcp_idempotency
       WHERE operation = ? AND idempotency_key = ?) AS response_json
    `).bind(
      OPERATION, input.idempotencyKey, requestHash,
      OPERATION, input.idempotencyKey, requestHash, attemptId,
      OPERATION, input.idempotencyKey, requestHash,
      input.taskId, input.taskId, input.taskId, input.taskId, input.expectedVersion,
      OPERATION, input.idempotencyKey
    );

    let results;
    try {
      results = await this.db.batch([acquire, update, appendEvent, classify]);
      if (!Array.isArray(results) || results.some(item => item?.success === false)) {
        throw new Error("D1_BATCH_FAILED");
      }
    } catch {
      const failure = await this.#classifyFailure(input, requestHash);
      if (failure instanceof Error) throw failure;
      return failure;
    }
    return completionOutcome(results[3]?.results?.[0]);
  }

  async getTimeline({ containerId, taskId, global, limit }) {
    try {
      const clauses = [];
      const values = [];
      if (global !== true && containerId !== undefined) {
        clauses.push("container_id = ?");
        values.push(containerId);
      }
      if (global !== true && taskId !== undefined) {
        clauses.push("task_id = ?");
        values.push(taskId);
      }
      values.push(limit);
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const rows = await this.db.prepare(`
        SELECT event_id, container_id, task_id, event_type, description, origin,
               occurred_at, idempotency_operation, idempotency_key
        FROM timeline_events
        ${where}
        ORDER BY occurred_at DESC, event_id DESC
        LIMIT ?
      `).bind(...values).all();
      return {
        scope: global === true ? "GLOBAL" : taskId !== undefined ? "TASK" : "CONTAINER",
        containerId: containerId ?? null,
        taskId: taskId ?? null,
        limit,
        count: (rows.results || []).length,
        events: (rows.results || []).map(mapEvent)
      };
    } catch {
      throw completionError("D1_OPERATION_FAILED", "The Timeline could not be read.", true);
    }
  }

  async #taskWithContainer(taskId) {
    try {
      return await this.db.prepare(`
        SELECT ${TASK_COLUMNS}
        FROM tasks AS task
        JOIN containers AS container ON container.container_id = task.container_id
        WHERE task.task_id = ?
      `).bind(taskId).first();
    } catch {
      throw completionError("D1_OPERATION_FAILED", "The Task could not be read.", true);
    }
  }

  async #classifyFailure(input, requestHash) {
    try {
      const existing = await this.db.prepare(`
        SELECT request_hash, response_json
        FROM mcp_idempotency
        WHERE operation = ? AND idempotency_key = ?
      `).bind(OPERATION, input.idempotencyKey).first();
      if (existing) return replayOrConflict(existing, requestHash);
      const current = await this.#taskWithContainer(input.taskId);
      validateCurrent(current, input.expectedVersion);
    } catch (error) {
      if (error instanceof TaskCompletionDomainError) return error;
    }
    return completionError("D1_OPERATION_FAILED", "The Task completion could not be changed.", true);
  }
}

export class TaskCompletionDomainError extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.name = "TaskCompletionDomainError";
    this.code = code;
    this.retryable = retryable;
  }
}

function validateCurrent(row, expectedVersion) {
  if (!row) throw completionError("TASK_NOT_FOUND", "The Task does not exist.");
  if (row.lifecycle_state === "ARCHIVED") {
    throw completionError("TASK_ARCHIVED", "An archived Task cannot change completion state.");
  }
  if (row.container_lifecycle_state === "ARCHIVED") {
    throw completionError("CONTAINER_ARCHIVED",
      "A Task in an archived Container cannot change completion state.");
  }
  if (Number(row.version) !== expectedVersion) {
    throw completionError("TASK_VERSION_CONFLICT", "The Task changed since it was read.");
  }
}

function completionOutcome(outcome) {
  if (!outcome?.outcome) {
    throw completionError("D1_OPERATION_FAILED", "The completion result was unavailable.", true);
  }
  if (outcome.outcome === "COMPLETED") return JSON.parse(outcome.response_json);
  if (outcome.outcome === "REPLAY") return replay(JSON.parse(outcome.response_json));
  if (outcome.outcome === "IDEMPOTENCY_CONFLICT") {
    throw completionError("IDEMPOTENCY_KEY_CONFLICT",
      "The idempotency key was already used with a different request.");
  }
  const errors = {
    TASK_NOT_FOUND: ["The Task does not exist.", false],
    TASK_ARCHIVED: ["An archived Task cannot change completion state.", false],
    CONTAINER_ARCHIVED: ["A Task in an archived Container cannot change completion state.", false],
    TASK_VERSION_CONFLICT: ["The Task changed since it was read.", false],
    UNEXPECTED_STATE: ["The Task completion could not be changed.", true]
  };
  const [message, retryable] = errors[outcome.outcome] || errors.UNEXPECTED_STATE;
  throw completionError(outcome.outcome === "UNEXPECTED_STATE"
    ? "D1_OPERATION_FAILED" : outcome.outcome, message, retryable);
}

function replayOrConflict(existing, requestHash) {
  if (existing.request_hash !== requestHash) {
    throw completionError("IDEMPOTENCY_KEY_CONFLICT",
      "The idempotency key was already used with a different request.");
  }
  return replay(JSON.parse(existing.response_json));
}

function replay(value) {
  return { ...value, replayed: true };
}

function completionError(code, message, retryable = false) {
  return new TaskCompletionDomainError(code, message, retryable);
}

function mapTask(row) {
  return {
    taskId: row.task_id,
    containerId: row.container_id,
    title: row.title,
    description: row.description ?? null,
    status: row.status,
    priority: row.priority ?? null,
    assignee: row.assignee ?? null,
    dueDate: row.due_date ?? null,
    lifecycleState: row.lifecycle_state,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? null,
    archivedAt: row.archived_at ?? null
  };
}

function mapEvent(row) {
  return {
    eventId: row.event_id,
    containerId: row.container_id,
    taskId: row.task_id ?? null,
    type: row.event_type,
    description: row.description,
    origin: row.origin,
    occurredAt: row.occurred_at,
    idempotencyOperation: row.idempotency_operation,
    idempotencyKey: row.idempotency_key
  };
}

export function projectTaskCompletion(row, transition, now) {
  const complete = transition === "COMPLETE";
  const changed = complete ? row.completed_at === null : row.completed_at !== null;
  const task = mapTask({
    ...row,
    status: changed ? (complete ? "DONE" : "OPEN") : row.status,
    completed_at: changed ? (complete ? now : null) : row.completed_at,
    version: changed ? Number(row.version) + 1 : Number(row.version),
    updated_at: changed ? now : row.updated_at
  });
  return {
    changed,
    task,
    eventType: complete ? "TASK_COMPLETED" : "TASK_REOPENED",
    eventDescription: complete
      ? `Task "${row.title}" completed.`
      : `Task "${row.title}" reopened.`
  };
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
