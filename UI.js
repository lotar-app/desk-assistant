function showUpdateProject() {

  const html = HtmlService
    .createHtmlOutputFromFile("DeskPanel")
    .setTitle("Desk");

  SpreadsheetApp
    .getUi()
    .showSidebar(html);

}

function getProjects() {
  return DeskEngine.listProjects();
}

function getProject(id) {

  return serializeProject(DeskEngine.getProject(id));

}

function saveProjectUpdate(payload) {

  const project = DeskEngine.saveProjectUpdate(payload);

  return serializeProject(project);

}

function getProjectBriefing(projectId) {

  const briefing = DeskEngine.getProjectBriefing(projectId);

  return {
    project: serializeProject(briefing.project),
    openTasks: briefing.openTasks.map(task => serializeTask(task)),
    timeline: briefing.timeline.map(event => serializeTimelineEvent(event))
  };

}

function getProjectTasks(projectId) {

  return DeskEngine
    .listProjectTasks(projectId)
    .map(task => serializeTask(task));

}

function completeTask(id) {

  return serializeTask(DeskEngine.completeTask(id));

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
