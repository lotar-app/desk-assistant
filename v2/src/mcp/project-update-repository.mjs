import { projectTaskCompletion } from "./task-completion-repository.mjs";

const OPERATION = "desk_v2_apply_project_update";
const ORIGIN = "desk_v2_apply_project_update";
const RESOURCE_TYPE = "container";
const PROJECT_COLUMNS = `
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
const PROJECT_PATCH_COLUMNS = {
  name: "name",
  status: "status",
  focus: "focus",
  owner: "owner",
  nextAction: "next_action"
};

export class ProjectUpdateRepository {
  constructor(db) {
    this.db = db;
  }

  async applyProjectUpdate(input) {
    const canonicalPayload = JSON.stringify({
      projectId: input.projectId,
      expectedProjectVersion: input.expectedProjectVersion,
      projectPatch: input.projectPatch,
      newTasks: input.newTasks,
      taskTransitions: input.taskTransitions,
      timelineEvent: input.timelineEvent
    });
    const requestHash = await sha256(canonicalPayload);
    const existing = await this.#receipt(input.idempotencyKey);
    if (existing) return replayOrConflict(existing, requestHash);

    const project = await this.#project(input.projectId);
    validateProject(project, input.expectedProjectVersion);
    const transitionRows = await Promise.all(input.taskTransitions.map(async transition => ({
      transition,
      row: await this.#task(transition.taskId)
    })));
    for (const item of transitionRows) validateTransition(item, input.projectId);

    const now = new Date().toISOString();
    const projectChanged = Object.entries(input.projectPatch).some(([field, value]) => (
      project[PROJECT_PATCH_COLUMNS[field]] !== value
    ));
    const projectedProject = mapProject({
      ...project,
      ...Object.fromEntries(Object.entries(input.projectPatch).map(([field, value]) => [
        PROJECT_PATCH_COLUMNS[field], value
      ])),
      version: projectChanged ? Number(project.version) + 1 : Number(project.version),
      updated_at: projectChanged ? now : project.updated_at
    });
    const createdTasks = input.newTasks.map(value => mapTask({
      task_id: `TSK-${crypto.randomUUID()}`,
      container_id: input.projectId,
      title: value.title,
      description: value.description,
      status: value.status,
      priority: value.priority,
      assignee: value.assignee,
      due_date: value.dueDate,
      lifecycle_state: "ACTIVE",
      version: 1,
      created_at: now,
      updated_at: now,
      completed_at: null,
      archived_at: null
    }));
    const transitionResults = transitionRows.map(({ transition, row }) => ({
      transition: transition.transition,
      ...projectTaskCompletion(row, transition.transition, now)
    }));
    const changed = projectChanged || createdTasks.length > 0
      || transitionResults.some(item => item.changed);
    const event = changed ? {
      eventId: `EVT-${crypto.randomUUID()}`,
      containerId: input.projectId,
      taskId: null,
      type: input.timelineEvent.type,
      description: input.timelineEvent.description,
      origin: ORIGIN,
      occurredAt: now,
      idempotencyOperation: OPERATION,
      idempotencyKey: input.idempotencyKey
    } : null;
    const responseJson = JSON.stringify({
      replayed: false,
      changed,
      project: projectedProject,
      createdTasks,
      transitionedTasks: transitionResults.map(item => ({
        transition: item.transition,
        changed: item.changed,
        task: item.task
      })),
      timelineEvent: event
    });
    const attemptId = crypto.randomUUID();
    const statements = [this.#acquireStatement(
      input, transitionRows, requestHash, attemptId, responseJson, now
    )];
    if (projectChanged) {
      statements.push(this.#projectUpdateStatement(
        input, requestHash, attemptId, now
      ));
    }
    for (const task of createdTasks) {
      statements.push(this.#taskInsertStatement(task, input.idempotencyKey,
        requestHash, attemptId));
    }
    for (const item of transitionResults.filter(value => value.changed)) {
      const expectedVersion = input.taskTransitions.find(value => (
        value.taskId === item.task.taskId
      )).expectedVersion;
      statements.push(this.#taskTransitionStatement(
        item.task, expectedVersion, input.idempotencyKey, requestHash, attemptId, now
      ));
    }
    if (event) {
      statements.push(this.#timelineStatement(event, requestHash, attemptId));
    }
    statements.push(this.db.prepare(`
      SELECT request_hash, response_json, attempt_id
      FROM mcp_idempotency
      WHERE operation = ? AND idempotency_key = ?
    `).bind(OPERATION, input.idempotencyKey));

    let results;
    try {
      results = await this.db.batch(statements);
      if (!Array.isArray(results) || results.some(item => item?.success === false)) {
        throw new Error("D1_BATCH_FAILED");
      }
    } catch {
      return this.#classifyFailure(input, requestHash);
    }
    const receipt = results.at(-1)?.results?.[0];
    if (!receipt) return this.#classifyFailure(input, requestHash);
    if (receipt.request_hash !== requestHash) throw conflict();
    return replayIfNeeded(JSON.parse(receipt.response_json), receipt.attempt_id, attemptId);
  }

  #acquireStatement(input, transitionRows, requestHash, attemptId, responseJson, now) {
    const taskGuards = transitionRows.map(() => `AND EXISTS (
      SELECT 1 FROM tasks
      WHERE task_id = ? AND container_id = ? AND lifecycle_state = 'ACTIVE' AND version = ?
    )`).join("\n");
    const values = [
      OPERATION, input.idempotencyKey, requestHash, attemptId, RESOURCE_TYPE,
      input.projectId, responseJson, now, input.projectId, input.expectedProjectVersion
    ];
    for (const { transition } of transitionRows) {
      values.push(transition.taskId, input.projectId, transition.expectedVersion);
    }
    return this.db.prepare(`
      INSERT INTO mcp_idempotency
        (operation, idempotency_key, request_hash, attempt_id, resource_type,
         resource_id, response_json, completed_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM containers
        WHERE container_id = ? AND lifecycle_state = 'ACTIVE' AND version = ?
      )
      ${taskGuards}
      ON CONFLICT(operation, idempotency_key) DO NOTHING
    `).bind(...values);
  }

  #projectUpdateStatement(input, requestHash, attemptId, now) {
    const entries = Object.entries(input.projectPatch).filter(([field, value]) => (
      value !== undefined && PROJECT_PATCH_COLUMNS[field]
    ));
    const assignments = entries.map(([field]) => `${PROJECT_PATCH_COLUMNS[field]} = ?`);
    const values = entries.map(([, value]) => value);
    values.push(now, input.projectId, input.expectedProjectVersion,
      OPERATION, input.idempotencyKey, requestHash, attemptId);
    return this.db.prepare(`
      UPDATE containers
      SET ${assignments.join(", ")}, version = version + 1, updated_at = ?
      WHERE container_id = ? AND lifecycle_state = 'ACTIVE' AND version = ?
        AND EXISTS (
          SELECT 1 FROM mcp_idempotency
          WHERE operation = ? AND idempotency_key = ? AND request_hash = ?
            AND attempt_id = ?
        )
    `).bind(...values);
  }

  #taskInsertStatement(task, key, requestHash, attemptId) {
    return this.db.prepare(`
      INSERT INTO tasks
        (task_id, container_id, title, description, status, priority, assignee, due_date,
         lifecycle_state, version, created_at, updated_at, completed_at, archived_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 1, ?, ?, NULL, NULL
      WHERE EXISTS (
        SELECT 1 FROM mcp_idempotency
        WHERE operation = ? AND idempotency_key = ? AND request_hash = ?
          AND attempt_id = ?
      )
    `).bind(
      task.taskId, task.containerId, task.title, task.description, task.status,
      task.priority, task.assignee, task.dueDate, task.createdAt, task.updatedAt,
      OPERATION, key, requestHash, attemptId
    );
  }

  #taskTransitionStatement(task, expectedVersion, key, requestHash, attemptId, now) {
    return this.db.prepare(`
      UPDATE tasks
      SET status = ?, completed_at = ?, version = version + 1, updated_at = ?
      WHERE task_id = ? AND container_id = ? AND lifecycle_state = 'ACTIVE' AND version = ?
        AND EXISTS (
          SELECT 1 FROM mcp_idempotency
          WHERE operation = ? AND idempotency_key = ? AND request_hash = ?
            AND attempt_id = ?
        )
    `).bind(
      task.status, task.completedAt, now, task.taskId, task.containerId, expectedVersion,
      OPERATION, key, requestHash, attemptId
    );
  }

  #timelineStatement(event, requestHash, attemptId) {
    return this.db.prepare(`
      INSERT INTO timeline_events
        (event_id, container_id, task_id, event_type, description, origin,
         occurred_at, idempotency_operation, idempotency_key)
      SELECT ?, ?, NULL, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM mcp_idempotency
        WHERE operation = ? AND idempotency_key = ? AND request_hash = ?
          AND attempt_id = ?
      )
    `).bind(
      event.eventId, event.containerId, event.type, event.description, event.origin,
      event.occurredAt, event.idempotencyOperation, event.idempotencyKey,
      OPERATION, event.idempotencyKey, requestHash, attemptId
    );
  }

  async #classifyFailure(input, requestHash) {
    const existing = await this.#receipt(input.idempotencyKey);
    if (existing) return replayOrConflict(existing, requestHash);
    const project = await this.#project(input.projectId);
    validateProject(project, input.expectedProjectVersion);
    for (const transition of input.taskTransitions) {
      validateTransition({ transition, row: await this.#task(transition.taskId) }, input.projectId);
    }
    throw updateError("D1_OPERATION_FAILED", "The coordinated update failed atomically.", true);
  }

  async #receipt(key) {
    try {
      return await this.db.prepare(`
        SELECT request_hash, response_json, attempt_id
        FROM mcp_idempotency
        WHERE operation = ? AND idempotency_key = ?
      `).bind(OPERATION, key).first();
    } catch {
      throw updateError("D1_OPERATION_FAILED", "The idempotency receipt could not be read.", true);
    }
  }

  async #project(projectId) {
    try {
      return await this.db.prepare(`
        SELECT ${PROJECT_COLUMNS}
        FROM containers
        WHERE container_id = ?
      `).bind(projectId).first();
    } catch {
      throw updateError("D1_OPERATION_FAILED", "The Project could not be read.", true);
    }
  }

  async #task(taskId) {
    try {
      return await this.db.prepare(`
        SELECT ${TASK_COLUMNS}
        FROM tasks
        WHERE task_id = ?
      `).bind(taskId).first();
    } catch {
      throw updateError("D1_OPERATION_FAILED", "A Task could not be read.", true);
    }
  }
}

export class ProjectUpdateDomainError extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.name = "ProjectUpdateDomainError";
    this.code = code;
    this.retryable = retryable;
  }
}

function validateProject(project, expectedVersion) {
  if (!project) throw updateError("PROJECT_NOT_FOUND", "The Project Container does not exist.");
  if (project.lifecycle_state === "ARCHIVED") {
    throw updateError("PROJECT_ARCHIVED", "An archived Project cannot be updated.");
  }
  if (Number(project.version) !== expectedVersion) {
    throw updateError("PROJECT_VERSION_CONFLICT", "The Project changed since it was read.");
  }
}

function validateTransition({ transition, row }, projectId) {
  if (!row) throw updateError("TASK_NOT_FOUND", `Task ${transition.taskId} does not exist.`);
  if (row.container_id !== projectId) {
    throw updateError("TASK_OUT_OF_SCOPE", `Task ${transition.taskId} is outside the Project.`);
  }
  if (row.lifecycle_state === "ARCHIVED") {
    throw updateError("TASK_ARCHIVED", `Task ${transition.taskId} is archived.`);
  }
  if (Number(row.version) !== transition.expectedVersion) {
    throw updateError("TASK_VERSION_CONFLICT", `Task ${transition.taskId} changed since it was read.`);
  }
}

function replayOrConflict(existing, requestHash) {
  if (existing.request_hash !== requestHash) throw conflict();
  return { ...JSON.parse(existing.response_json), replayed: true };
}

function replayIfNeeded(value, receiptAttemptId, currentAttemptId) {
  return receiptAttemptId === currentAttemptId ? value : { ...value, replayed: true };
}

function conflict() {
  return updateError("IDEMPOTENCY_KEY_CONFLICT",
    "The idempotency key was already used with a different request.");
}

function updateError(code, message, retryable = false) {
  return new ProjectUpdateDomainError(code, message, retryable);
}

function mapProject(row) {
  return {
    containerId: row.container_id,
    parentId: row.parent_id ?? null,
    name: row.name,
    status: row.status,
    focus: row.focus ?? null,
    owner: row.owner ?? null,
    nextAction: row.next_action ?? null,
    lifecycleState: row.lifecycle_state,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at ?? null
  };
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

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
