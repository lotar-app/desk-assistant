/**
 * TASK SERVICE
 */

const TaskService = {

  create(projectId, data) {

    if (!projectId) {
      throw new Error("Progetto non valido.");
    }

    const project = ProjectService.get(projectId);

    if (!project) {
      throw new Error("Progetto non trovato.");
    }

    if (!data || typeof data !== "object") {
      throw new Error("Payload non valido.");
    }

    const title = String(data.title || "").trim();

    if (!title) {
      throw new Error("Titolo attività non valido.");
    }

    const now = new Date();

    const id = Utilities.formatDate(
      now,
      Session.getScriptTimeZone(),
      "'TSK-'yyyyMMddHHmmss"
    );

    TaskRepository.append([
      id,
      projectId,
      title,
      String(data.description || ""),
      CONFIG.TASK_STATUS.OPEN,
      String(data.priority || CONFIG.TASK_PRIORITY.NORMAL),
      String(data.assignee || CONFIG.DEFAULT_OWNER),
      data.dueDate || "",
      now,
      now,
      ""
    ]);

    addTimeline(
      projectId,
      "TASK_CREATED",
      "Creata attività: " + title
    );

    return id;

  },

  update(id, data) {

    if (!id) {
      throw new Error("Attività non valida.");
    }

    if (!data || typeof data !== "object") {
      throw new Error("Payload non valido.");
    }

    const task = TaskRepository.getById(id);

    if (!task) {
      throw new Error("Attività non trovata.");
    }

    data.updatedAt = new Date();

    const saved = TaskRepository.update(id, data);

    if (!saved) {
      throw new Error("Attività non trovata.");
    }

    return TaskRepository.getById(id);

  },

  listByProject(projectId) {

    if (!projectId) {
      throw new Error("Progetto non valido.");
    }

    return TaskRepository.listByProject(projectId);

  },

  listOpen() {

    return TaskRepository
      .list()
      .filter(task => (
        task.status !== CONFIG.TASK_STATUS.COMPLETED &&
        !task.completedAt
      ));

  },

  complete(id) {

    const now = new Date();
    const task = TaskRepository.getById(id);

    if (!task) {
      throw new Error("Attività non trovata.");
    }

    if (task.status === CONFIG.TASK_STATUS.COMPLETED) {
      return task;
    }

    const completedTask = this.update(id, {
      status: CONFIG.TASK_STATUS.COMPLETED,
      completedAt: now
    });

    addTimeline(
      task.projectId,
      "TASK_COMPLETED",
      "Completata attività: " + task.title
    );

    return completedTask;

  }

};
