/**
 * PROJECT SERVICE
 */

const ProjectService = {

  create(name, workspace) {

    const now = new Date();
    const id = this.generateId(now);
    const projectWorkspace = WorkspaceService.resolveForAssignment(workspace).id;

    ProjectRepository.append([
      id,
      name,
      CONFIG.PROJECT_STATUS.IN_PROGRESS,
      "",
      CONFIG.DEFAULT_OWNER,
      "",
      now,
      now,
      projectWorkspace
    ]);

    addTimeline(
      id,
      "PROJECT_CREATED",
      "Progetto creato"
    );

    return id;

  },

  generateId(date) {
    const timestamp = date instanceof Date ? date : new Date();

    if (isNaN(timestamp.getTime())) {
      throw new Error("Data non valida per la generazione del Project ID.");
    }

    return Utilities.formatDate(
      timestamp,
      Session.getScriptTimeZone(),
      "'PRJ-'yyyyMMddHHmmss"
    );
  },

  get(id) {
    return normalizeProject(ProjectRepository.getById(id), true);
  },

  listAll() {
    return ProjectRepository.listAll().map(project => normalizeProject(project));
  },

  listByWorkspace(workspace) {
    const selectedWorkspace = WorkspaceService.resolveForAssignment(workspace);
    return ProjectRepository
      .listByWorkspace(selectedWorkspace.id)
      .map(project => normalizeProject(project));
  },

  findByName(name) {

    const projectName = String(name || "").trim();

    if (!projectName) {
      throw new Error("Nome progetto non valido.");
    }

    const normalizedName = projectName.toLowerCase();
    const projects = ProjectRepository.list();

    for (const project of projects) {

      if (String(project.name || "").trim().toLowerCase() === normalizedName) {
        return this.get(project.id);
      }

    }

    return null;

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
      updatedAt: updatedAt,
      workspaceId: data.workspaceId
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

function normalizeProject(project, includeWorkspaceName) {

  if (!project) {
    return null;
  }

  project.status = normalizeProjectStatus(project.status);
  project.workspaceId = WorkspaceSettings.normalize(project.workspaceId);

  if (includeWorkspaceName) {
    const workspace = WorkspaceService.resolve(project.workspaceId, {
      includeDisabled: true
    });
    project.workspace = workspace ? workspace.name : "";
  }

  return project;

}

function normalizeProjectStatus(status) {

  const value = String(status || "").trim();

  if (
    value === CONFIG.PROJECT_STATUS.IN_PROGRESS ||
    value === CONFIG.PROJECT_STATUS.WAITING ||
    value === CONFIG.PROJECT_STATUS.PAUSED ||
    value === CONFIG.PROJECT_STATUS.BLOCKED ||
    value === CONFIG.PROJECT_STATUS.COMPLETED
  ) {
    return value;
  }

  if (value === "In pausa") {
    return CONFIG.PROJECT_STATUS.PAUSED;
  }

  if (value === "DONE" || value === "Chiuso") {
    return CONFIG.PROJECT_STATUS.COMPLETED;
  }

  return CONFIG.PROJECT_STATUS.IN_PROGRESS;

}
