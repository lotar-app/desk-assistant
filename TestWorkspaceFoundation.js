function testWorkspaceFoundation() {
  const originalAppend = ProjectRepository.append;
  const originalAddTimeline = addTimeline;
  const originalProjectListAll = ProjectService.listAll;
  const originalTaskListOpen = TaskService.listOpen;
  const originalTimelineList = TimelineRepository.list;
  const originalWorkspaceList = WorkspaceService.list;
  const originalWorkspaceDefault = WorkspaceService.getDefault;
  const originalWorkspaceResolve = WorkspaceService.resolve;
  const originalWorkspaceResolveForAssignment = WorkspaceService.resolveForAssignment;
  let appendedProject = null;

  try {
    const testWorkspaces = [
      { id: "WS0001", name: "Lotar", isDefault: true, status: "ACTIVE" },
      { id: "WS0002", name: "Max", isDefault: false, status: "ACTIVE" }
    ];
    WorkspaceService.list = function() { return testWorkspaces; };
    WorkspaceService.getDefault = function() { return testWorkspaces[0]; };
    WorkspaceService.resolve = function(value) {
      const key = String(value || "").trim().toLowerCase();
      return testWorkspaces.find(workspace => (
        workspace.id.toLowerCase() === key || workspace.name.toLowerCase() === key
      )) || null;
    };
    WorkspaceService.resolveForAssignment = function(value) {
      const workspace = value ? this.resolve(value) : this.getDefault();
      if (!workspace) throw new Error("Workspace non trovato.");
      return workspace;
    };

    ProjectRepository.append = function(row) {
      appendedProject = row;
    };

    addTimeline = function() {};

    const projectId = ProjectService.create("Workspace test");

    assertWorkspaceFoundation(!!projectId, "Project ID non generato.");
    assertWorkspaceFoundation(
      appendedProject[CONFIG.PROJECT_COLUMNS.WORKSPACE_ID - 1] === "WS0001",
      "Il progetto non usa il workspace predefinito."
    );

    ProjectService.listAll = function() {
      return [
        workspaceFoundationProject(
          "PRJ-DONE",
          "WS0001",
          CONFIG.PROJECT_STATUS.COMPLETED,
          "2026-07-14T12:00:00.000Z",
          ""
        ),
        workspaceFoundationProject(
          "PRJ-WAITING",
          "WS0001",
          CONFIG.PROJECT_STATUS.WAITING,
          "2026-07-12T12:00:00.000Z"
        ),
        workspaceFoundationProject(
          "PRJ-IN-PROGRESS-OLD",
          "WS0001",
          CONFIG.PROJECT_STATUS.IN_PROGRESS,
          "2026-07-10T12:00:00.000Z"
        ),
        workspaceFoundationProject(
          "PRJ-BLOCKED",
          "WS0001",
          CONFIG.PROJECT_STATUS.BLOCKED,
          "2026-07-13T12:00:00.000Z"
        ),
        workspaceFoundationProject(
          "PRJ-IN-PROGRESS-NEW",
          "WS0001",
          CONFIG.PROJECT_STATUS.IN_PROGRESS,
          "2026-07-11T12:00:00.000Z"
        ),
        workspaceFoundationProject("PRJ-MAX", "WS0002"),
        workspaceFoundationProject("PRJ-UNCLASSIFIED", "")
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
      }, {
        date: new Date("2026-07-14T09:00:00.000Z"),
        projectId: "PRJ-MAX",
        type: "PROJECT_UPDATED",
        description: "Evento workspace Max"
      }];
    };

    const defaultBriefing = DeskEngine.getWorkspaceBriefing();
    const maxBriefing = DeskEngine.getWorkspaceBriefing("max");
    const freelanceBriefing = DeskEngine.getWorkspaceBriefing({
      scope: "FREELANCE"
    });
    const allBriefing = DeskEngine.getWorkspaceBriefing({ scope: "ALL" });

    JSON.stringify(defaultBriefing);

    assertWorkspaceFoundation(
      defaultBriefing.workspaceId === "WS0001" &&
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
      maxBriefing.workspaceId === "WS0002" &&
      maxBriefing.workspaces[0].id === "WS0002" &&
      maxBriefing.counts.projects === 1 &&
      maxBriefing.counts.openTasks === 1,
      "Il briefing esplicito non isola MAX."
    );
    assertWorkspaceFoundation(
      freelanceBriefing.counts.projects === 1 &&
      freelanceBriefing.recentContext[0].projectId === "PRJ-MAX" &&
      freelanceBriefing.recentContext[0].openTasks[0].taskId === "TSK-MAX" &&
      freelanceBriefing.recentContext[0].lastUpdate.text === "Evento workspace Max",
      "Il briefing freelance non filtra progetti, task o Timeline."
    );
    assertWorkspaceFoundation(
      allBriefing.counts.projects === 6 &&
      allBriefing.recentContext.every(project => (
        project.projectId !== "PRJ-UNCLASSIFIED"
      )),
      "Il briefing tutte include dati non classificati o perde workspace validi."
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
      explicitWorkspace: maxBriefing.workspaceId
    };
  } finally {
    WorkspaceService.list = originalWorkspaceList;
    WorkspaceService.getDefault = originalWorkspaceDefault;
    WorkspaceService.resolve = originalWorkspaceResolve;
    WorkspaceService.resolveForAssignment = originalWorkspaceResolveForAssignment;
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
    workspaceId: workspace
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
