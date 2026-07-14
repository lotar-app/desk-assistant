function testWorkspaceFoundation() {
  const originalSettingsGet = WorkspaceSettings.get;
  const originalAppend = ProjectRepository.append;
  const originalAddTimeline = addTimeline;
  const originalProjectListAll = ProjectService.listAll;
  const originalTaskListOpen = TaskService.listOpen;
  const originalTimelineList = TimelineRepository.list;
  let appendedProject = null;

  try {
    WorkspaceSettings.get = function(key) {
      return key === "defaultWorkspace" ? "LOTAR" : "";
    };

    ProjectRepository.append = function(row) {
      appendedProject = row;
    };

    addTimeline = function() {};

    const projectId = ProjectService.create("Workspace test");

    assertWorkspaceFoundation(!!projectId, "Project ID non generato.");
    assertWorkspaceFoundation(
      appendedProject[CONFIG.PROJECT_COLUMNS.WORKSPACE - 1] === "LOTAR",
      "Il progetto non usa il workspace predefinito."
    );

    ProjectService.listAll = function() {
      return [
        workspaceFoundationProject("PRJ-LOTAR", "LOTAR"),
        workspaceFoundationProject("PRJ-MAX", "MAX")
      ];
    };

    TaskService.listOpen = function() {
      return [
        workspaceFoundationTask("TSK-LOTAR", "PRJ-LOTAR"),
        workspaceFoundationTask("TSK-MAX", "PRJ-MAX")
      ];
    };

    TimelineRepository.list = function() {
      return [];
    };

    const defaultBriefing = DeskEngine.getWorkspaceBriefing();
    const maxBriefing = DeskEngine.getWorkspaceBriefing("max");

    assertWorkspaceFoundation(
      defaultBriefing.workspace === "LOTAR" &&
      defaultBriefing.counts.projects === 1 &&
      defaultBriefing.counts.openTasks === 1,
      "Il briefing predefinito non isola LOTAR."
    );
    assertWorkspaceFoundation(
      maxBriefing.workspace === "MAX" &&
      maxBriefing.counts.projects === 1 &&
      maxBriefing.counts.openTasks === 1,
      "Il briefing esplicito non isola MAX."
    );

    return {
      success: true,
      defaultWorkspace: defaultBriefing.workspace,
      explicitWorkspace: maxBriefing.workspace
    };
  } finally {
    WorkspaceSettings.get = originalSettingsGet;
    ProjectRepository.append = originalAppend;
    addTimeline = originalAddTimeline;
    ProjectService.listAll = originalProjectListAll;
    TaskService.listOpen = originalTaskListOpen;
    TimelineRepository.list = originalTimelineList;
  }
}

function workspaceFoundationProject(id, workspace) {
  return {
    id: id,
    name: id,
    status: CONFIG.PROJECT_STATUS.IN_PROGRESS,
    focus: "Focus",
    owner: "Max",
    nextAction: "Prossima azione",
    createdAt: new Date(),
    updatedAt: new Date(),
    workspace: workspace
  };
}

function workspaceFoundationTask(id, projectId) {
  return {
    id: id,
    projectId: projectId,
    title: id,
    status: CONFIG.TASK_STATUS.OPEN,
    priority: CONFIG.TASK_PRIORITY.NORMAL,
    dueDate: "",
    updatedAt: new Date()
  };
}

function assertWorkspaceFoundation(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
