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
        workspaceFoundationProject(
          "PRJ-DONE",
          "LOTAR",
          CONFIG.PROJECT_STATUS.COMPLETED,
          "2026-07-14T12:00:00.000Z",
          ""
        ),
        workspaceFoundationProject(
          "PRJ-WAITING",
          "LOTAR",
          CONFIG.PROJECT_STATUS.WAITING,
          "2026-07-12T12:00:00.000Z"
        ),
        workspaceFoundationProject(
          "PRJ-IN-PROGRESS-OLD",
          "LOTAR",
          CONFIG.PROJECT_STATUS.IN_PROGRESS,
          "2026-07-10T12:00:00.000Z"
        ),
        workspaceFoundationProject(
          "PRJ-BLOCKED",
          "LOTAR",
          CONFIG.PROJECT_STATUS.BLOCKED,
          "2026-07-13T12:00:00.000Z"
        ),
        workspaceFoundationProject(
          "PRJ-IN-PROGRESS-NEW",
          "LOTAR",
          CONFIG.PROJECT_STATUS.IN_PROGRESS,
          "2026-07-11T12:00:00.000Z"
        ),
        workspaceFoundationProject("PRJ-MAX", "MAX")
      ];
    };

    TaskService.listOpen = function() {
      return [
        workspaceFoundationTask("TSK-LOTAR", "PRJ-IN-PROGRESS-NEW"),
        workspaceFoundationTask("TSK-MAX", "PRJ-MAX")
      ];
    };

    TimelineRepository.list = function() {
      return [{
        date: new Date("2026-07-14T08:00:00.000Z"),
        projectId: "PRJ-IN-PROGRESS-OLD",
        type: "PROJECT_UPDATED",
        description: "Ultimo evento disponibile"
      }];
    };

    const defaultBriefing = DeskEngine.getWorkspaceBriefing();
    const maxBriefing = DeskEngine.getWorkspaceBriefing("max");

    JSON.stringify(defaultBriefing);

    assertWorkspaceFoundation(
      defaultBriefing.workspace === "LOTAR" &&
      defaultBriefing.counts.projects === 5 &&
      defaultBriefing.counts.openTasks === 1,
      "Il briefing predefinito non isola LOTAR."
    );
    assertWorkspaceFoundation(
      Array.isArray(defaultBriefing.recentContext) &&
      !!defaultBriefing.attentionSignals &&
      !!defaultBriefing.dataQuality,
      "La struttura precedente del briefing non è valida."
    );
    assertWorkspaceFoundation(
      maxBriefing.workspace === "MAX" &&
      maxBriefing.counts.projects === 1 &&
      maxBriefing.counts.openTasks === 1,
      "Il briefing esplicito non isola MAX."
    );
    assertWorkspaceFoundation(
      defaultBriefing.recentContext.map(project => project.projectId).join(",") ===
      "PRJ-IN-PROGRESS-OLD,PRJ-IN-PROGRESS-NEW,PRJ-WAITING,PRJ-BLOCKED,PRJ-DONE",
      "L'ordinamento operativo del briefing non è corretto."
    );
    assertWorkspaceFoundation(
      defaultBriefing.recentContext[0].lastUpdate.text ===
      "Ultimo evento disponibile",
      "L'ultimo aggiornamento Timeline non è esposto."
    );
    assertWorkspaceFoundation(
      defaultBriefing.recentContext[4].nextAction === "" &&
      defaultBriefing.recentContext[4].lastUpdate.date === "" &&
      defaultBriefing.recentContext[4].lastUpdate.text === "",
      "Un progetto senza nextAction o Timeline non è gestito correttamente."
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

function workspaceFoundationProject(id, workspace, status, updatedAt, nextAction) {
  return {
    id: id,
    name: id,
    status: status || CONFIG.PROJECT_STATUS.IN_PROGRESS,
    focus: "Focus",
    owner: "Max",
    nextAction: nextAction === undefined ? "Prossima azione" : nextAction,
    createdAt: new Date(),
    updatedAt: updatedAt ? new Date(updatedAt) : new Date(),
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
