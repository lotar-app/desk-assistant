const MAX_REFERENCE_MATCHES = 10;

const CONTAINER_COLUMNS = `
  container_id,
  parent_id,
  name,
  status,
  focus,
  next_action,
  lifecycle_state`;

const TASK_COLUMNS = `
  task_id,
  container_id,
  title,
  status,
  priority,
  due_date,
  lifecycle_state`;

export class ReadRepository {
  constructor(db) {
    this.db = db;
  }

  async resolveReference(input) {
    try {
      const matches = input.referenceType === "CONTAINER"
        ? await this.#resolveContainer(input)
        : await this.#resolveTask(input);
      if (matches.length === 0) {
        throw readError("REFERENCE_NOT_FOUND", "No matching Desk V2 reference was found.");
      }
      if (matches.length !== 1) {
        throw readError("AMBIGUOUS_REFERENCE",
          "The reference matches multiple Desk V2 records; provide a stable ID or a narrower scope.");
      }
      return { reference: matches[0] };
    } catch (error) {
      if (error instanceof ReadDomainError) throw error;
      throw readError("D1_OPERATION_FAILED", "The reference could not be resolved.", true);
    }
  }

  async getBriefing({ containerId, asOfDate, limit }) {
    if (containerId === undefined) {
      throw readError("SCOPE_REQUIRED",
        "A Container ID is required because Desk V2 has no implicit Workspace scope.");
    }
    try {
      const container = await this.db.prepare(`
        SELECT ${CONTAINER_COLUMNS}
        FROM containers
        WHERE container_id = ? AND lifecycle_state = 'ACTIVE'
      `).bind(containerId).first();
      if (!container) {
        throw readError("REFERENCE_NOT_FOUND", "The briefing Container was not found.");
      }

      const statusRows = await this.db.prepare(`
        SELECT status, COUNT(*) AS count
        FROM tasks
        WHERE container_id = ? AND lifecycle_state = 'ACTIVE'
        GROUP BY status
        ORDER BY status ASC
      `).bind(containerId).all();
      const taskRows = await this.db.prepare(`
        SELECT ${TASK_COLUMNS}
        FROM tasks
        WHERE container_id = ? AND lifecycle_state = 'ACTIVE'
        ORDER BY CASE WHEN due_date IS NULL THEN 1 ELSE 0 END,
                 due_date ASC, title ASC, task_id ASC
        LIMIT ?
      `).bind(containerId, limit).all();

      const byStatus = Object.fromEntries((statusRows.results || []).map(row => [
        row.status, Number(row.count)
      ]));
      const activeTasks = Object.values(byStatus).reduce((sum, count) => sum + count, 0);
      return {
        asOfDate,
        scope: mapContainer(container),
        counts: { activeTasks, byStatus },
        taskLimit: limit,
        truncated: activeTasks > limit,
        tasks: (taskRows.results || []).map(row => mapBriefingTask(row, asOfDate))
      };
    } catch (error) {
      if (error instanceof ReadDomainError) throw error;
      throw readError("D1_OPERATION_FAILED", "The briefing could not be read.", true);
    }
  }

  async #resolveContainer(input) {
    if (input.containerId !== undefined) {
      const row = await this.db.prepare(`
        SELECT ${CONTAINER_COLUMNS}
        FROM containers
        WHERE container_id = ?
      `).bind(input.containerId).first();
      return row ? [mapContainerReference(row)] : [];
    }

    const scopeClause = input.global === true
      ? ""
      : input.parentContainerId === null
        ? " AND parent_id IS NULL"
        : " AND parent_id = ?";
    const values = [input.name];
    if (input.global !== true && input.parentContainerId !== null) {
      values.push(input.parentContainerId);
    }
    values.push(MAX_REFERENCE_MATCHES + 1);
    const rows = await this.db.prepare(`
      SELECT ${CONTAINER_COLUMNS}
      FROM containers
      WHERE name = ? AND lifecycle_state = 'ACTIVE'${scopeClause}
      ORDER BY container_id ASC
      LIMIT ?
    `).bind(...values).all();
    return (rows.results || []).map(mapContainerReference);
  }

  async #resolveTask(input) {
    if (input.taskId !== undefined) {
      const row = await this.db.prepare(`
        SELECT ${TASK_COLUMNS}
        FROM tasks
        WHERE task_id = ?
      `).bind(input.taskId).first();
      return row ? [mapTaskReference(row)] : [];
    }

    const scopeClause = input.global === true ? "" : " AND container_id = ?";
    const values = input.global === true
      ? [input.title, MAX_REFERENCE_MATCHES + 1]
      : [input.title, input.containerId, MAX_REFERENCE_MATCHES + 1];
    const rows = await this.db.prepare(`
      SELECT ${TASK_COLUMNS}
      FROM tasks
      WHERE title = ? AND lifecycle_state = 'ACTIVE'${scopeClause}
      ORDER BY task_id ASC
      LIMIT ?
    `).bind(...values).all();
    return (rows.results || []).map(mapTaskReference);
  }
}

export class ReadDomainError extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.name = "ReadDomainError";
    this.code = code;
    this.retryable = retryable;
  }
}

function readError(code, message, retryable = false) {
  return new ReadDomainError(code, message, retryable);
}

function mapContainer(row) {
  return {
    containerId: row.container_id,
    parentId: row.parent_id ?? null,
    name: row.name,
    status: row.status,
    focus: row.focus ?? null,
    nextAction: row.next_action ?? null,
    lifecycleState: row.lifecycle_state
  };
}

function mapContainerReference(row) {
  return {
    referenceType: "CONTAINER",
    id: row.container_id,
    label: row.name,
    containerId: null,
    lifecycleState: row.lifecycle_state
  };
}

function mapTaskReference(row) {
  return {
    referenceType: "TASK",
    id: row.task_id,
    label: row.title,
    containerId: row.container_id,
    lifecycleState: row.lifecycle_state
  };
}

function mapBriefingTask(row, asOfDate) {
  return {
    taskId: row.task_id,
    title: row.title,
    status: row.status,
    priority: row.priority ?? null,
    dueDate: row.due_date ?? null,
    temporalState: temporalState(row.due_date, asOfDate)
  };
}

function temporalState(dueDate, asOfDate) {
  if (dueDate === null || dueDate === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return null;
  }
  if (dueDate < asOfDate) return "OVERDUE";
  if (dueDate === asOfDate) return "DUE_TODAY";
  return "FUTURE";
}
