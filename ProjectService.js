/**
 * PROJECT SERVICE
 */

const ProjectService = {

  create(name) {

    const now = new Date();

    const id = Utilities.formatDate(
      now,
      Session.getScriptTimeZone(),
      "'PRJ-'yyyyMMddHHmmss"
    );

    ProjectRepository.append([
      id,
      name,
      CONFIG.PROJECT_STATUS.IN_PROGRESS,
      "",
      CONFIG.DEFAULT_OWNER,
      "",
      now,
      now
    ]);

    addTimeline(
      id,
      "PROJECT_CREATED",
      "Progetto creato"
    );

    return id;

  },

  get(id) {
    return normalizeProject(ProjectRepository.getById(id));
  },

  update(id, data) {

    if (!id) {
      throw new Error("Progetto non valido.");
    }

    if (!data || typeof data !== "object") {
      throw new Error("Payload non valido.");
    }

    const project = ProjectRepository.getById(id);

    if (!project) {
      throw new Error("Progetto non trovato.");
    }

    const updateText = String(data.update || "").trim();
    const updatedAt = new Date();
    const status =
      data.status !== undefined
        ? normalizeProjectStatus(data.status)
        : normalizeProjectStatus(project.status);

    const saved = ProjectRepository.update(id, {
      status: status,
      focus: String(data.focus || ""),
      nextAction: String(data.nextAction || ""),
      updatedAt: updatedAt
    });

    if (!saved) {
      throw new Error("Progetto non trovato.");
    }

    if (updateText) {
      addTimeline(
        id,
        "PROJECT_UPDATED",
        updateText
      );
    }

    return this.get(id);

  }

};

function normalizeProject(project) {

  if (!project) {
    return null;
  }

  project.status = normalizeProjectStatus(project.status);

  return project;

}

function normalizeProjectStatus(status) {

  const value = String(status || "").trim();

  if (
    value === CONFIG.PROJECT_STATUS.IN_PROGRESS ||
    value === CONFIG.PROJECT_STATUS.WAITING ||
    value === CONFIG.PROJECT_STATUS.BLOCKED ||
    value === CONFIG.PROJECT_STATUS.COMPLETED
  ) {
    return value;
  }

  if (value === "In pausa") {
    return CONFIG.PROJECT_STATUS.WAITING;
  }

  if (value === "Chiuso") {
    return CONFIG.PROJECT_STATUS.COMPLETED;
  }

  return CONFIG.PROJECT_STATUS.IN_PROGRESS;

}
