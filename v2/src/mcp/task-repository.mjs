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
  CONTAINER_NOT_FOUND: ["The Container does not exist.", false],
  D1_OPERATION_FAILED: ["The Tasks could not be read.", true]
};

function taskError(code) {
  const [message, retryable] = TASK_ERRORS[code];
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
