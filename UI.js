function showUpdateProject() {

  const html = HtmlService
    .createHtmlOutputFromFile("DeskPanel")
    .setTitle("Desk");

  SpreadsheetApp
    .getUi()
    .showSidebar(html);

}

function getProjects() {
  return ProjectRepository.list();
}

function getProject(id) {

  const project = ProjectService.get(id);

  if (!project) {
    throw new Error("Progetto non trovato.");
  }

  return serializeProject(project);

}

function saveProjectUpdate(payload) {

  if (!payload || !payload.id) {
    throw new Error("Payload non valido.");
  }

  const project = ProjectService.update(payload.id, {
    update: payload.update,
    focus: payload.focus,
    nextAction: payload.nextAction,
    status: payload.status
  });

  const taskTitle = String(payload.newTask || "").trim();

  if (taskTitle) {
    TaskService.create(payload.id, {
      title: taskTitle
    });
  }

  return serializeProject(project);

}

function getProjectBriefing(projectId) {

  if (!projectId) {
    throw new Error("Progetto non valido.");
  }

  const project = ProjectService.get(projectId);

  if (!project) {
    throw new Error("Progetto non trovato.");
  }

  const openTasks = TaskService
    .listByProject(projectId)
    .filter(task => !isTaskCompleted(task))
    .map(task => serializeTask(task));

  const timeline = getLatestTimeline(projectId, 5)
    .map(event => serializeTimelineEvent(event));

  return {
    project: serializeProject(project),
    openTasks: openTasks,
    timeline: timeline
  };

}

function getProjectTasks(projectId) {

  if (!projectId) {
    throw new Error("Progetto non valido.");
  }

  return TaskService
    .listByProject(projectId)
    .map(task => serializeTask(task));

}

function completeTask(id) {

  if (!id) {
    throw new Error("Attività non valida.");
  }

  return serializeTask(TaskService.complete(id));

}

function serializeProject(project) {

  return {
    id: project.id,
    name: project.name,
    status: project.status,
    focus: project.focus,
    owner: project.owner,
    nextAction: project.nextAction,
    createdAt: serializeDate(project.createdAt),
    updatedAt: serializeDate(project.updatedAt)
  };

}

function serializeDate(value) {

  if (!value) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);

}

function serializeTask(task) {

  return {
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    assignee: task.assignee,
    dueDate: serializeDate(task.dueDate),
    createdAt: serializeDate(task.createdAt),
    updatedAt: serializeDate(task.updatedAt),
    completedAt: serializeDate(task.completedAt)
  };

}

function serializeTimelineEvent(event) {

  return {
    date: serializeDate(event.date),
    type: event.type,
    description: event.description
  };

}

function isTaskCompleted(task) {

  return task.status === CONFIG.TASK_STATUS.COMPLETED || !!task.completedAt;

}
