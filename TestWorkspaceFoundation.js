function testWorkspaceFoundation() {
  const originalAppend = ProjectRepository.append;
  const originalAddTimeline = addTimeline;
  const originalProjectListAll = ProjectService.listAll;
  const originalTaskListOpen = TaskService.listOpen;
  const originalTimelineList = TimelineRepository.list;
  const originalWorkspaceList = WorkspaceService.list;
  const originalWorkspaceDefault = WorkspaceService.getDefault;
  const originalWorkspaceResolve = WorkspaceService.resolve;
  const originalWorkspaceResolveByName = WorkspaceService.resolveByName;
  const originalWorkspaceResolveForAssignment = WorkspaceService.resolveForAssignment;
  let appendedProject = null;

  try {
    const testWorkspaces = [
      { id: "WS0001", name: "LOTAR", isDefault: true, status: "ACTIVE" },
      { id: "WS0002", name: "CLIENTI", isDefault: false, status: "ACTIVE" },
      { id: "WS0003", name: "PERSONALE", isDefault: false, status: "ACTIVE" }
    ];
    WorkspaceService.list = function() { return testWorkspaces; };
    WorkspaceService.getDefault = function() { return testWorkspaces[0]; };
    WorkspaceService.resolve = function(value) {
      const key = String(value || "").trim().toLowerCase();
      return testWorkspaces.find(workspace => (
        workspace.id.toLowerCase() === key || workspace.name.toLowerCase() === key
      )) || null;
    };
    WorkspaceService.resolveByName = function(value) {
      const key = String(value || "").trim().toLowerCase();
      return testWorkspaces.find(workspace => (
        workspace.name.toLowerCase() === key
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
        workspaceFoundationProject("PRJ-TUSCAN", "WS0002", null, null,
          null, "TuscanPledges"),
        workspaceFoundationProject("PRJ-ORE", "WS0003", null, null,
          null, "Registro Ore"),
        workspaceFoundationProject("PRJ-SCANNER", "WS0001", null, null,
          null, "Scanner"),
        workspaceFoundationProject("PRJ-UNCLASSIFIED", "")
      ];
    };

    TaskService.listOpen = function() {
      return [
        workspaceFoundationTask("TSK-LOTAR", "PRJ-IN-PROGRESS-NEW"),
        workspaceFoundationTask("TSK-TUSCAN", "PRJ-TUSCAN"),
        workspaceFoundationTask("TSK-ORE", "PRJ-ORE"),
        workspaceFoundationTask("TSK-SCANNER", "PRJ-SCANNER")
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
        projectId: "PRJ-TUSCAN",
        type: "PROJECT_UPDATED",
        description: "Evento TuscanPledges"
      }];
    };

    const defaultBriefing = DeskEngine.getWorkspaceBriefing();
    const lotarBriefing = DeskEngine.getWorkspaceBriefing("LOTAR");
    const clientiBriefing = DeskEngine.getWorkspaceBriefing("clienti");
    const personaleBriefing = DeskEngine.getWorkspaceBriefing({
      workspace: "PERSONALE"
    });
    const tuscanBriefing = DeskEngine.getWorkspaceBriefing("TuscanPledges");
    const oreBriefing = DeskEngine.getWorkspaceBriefing("Registro Ore");
    const scannerBriefing = DeskEngine.getWorkspaceBriefing("Scanner");
    const workspaceBeforeProject = workspaceBriefingSelection("CLIENTI", [
      workspaceFoundationProject("PRJ-COLLISION", "WS0001", null, null,
        null, "CLIENTI")
    ]);

    JSON.stringify(defaultBriefing);

    assertWorkspaceFoundation(
      defaultBriefing.workspaceId === "WS0001" &&
      defaultBriefing.workspace === "LOTAR" &&
      defaultBriefing.scope === CONFIG.WORKSPACE_SCOPE.WORKSPACE &&
      defaultBriefing.counts.projects === 6 &&
      defaultBriefing.counts.openTasks === 2,
      "Il briefing predefinito non isola LOTAR."
    );
    assertWorkspaceFoundation(
      lotarBriefing.workspaceId === defaultBriefing.workspaceId &&
      lotarBriefing.counts.projects === defaultBriefing.counts.projects,
      "Desk LOTAR non coincide con il briefing LOTAR predefinito."
    );
    assertWorkspaceFoundation(
      Array.isArray(defaultBriefing.recentContext) &&
      !!defaultBriefing.attentionSignals &&
      !!defaultBriefing.dataQuality,
      "La struttura precedente del briefing non è valida."
    );
    assertWorkspaceFoundation(
      clientiBriefing.workspaceId === "WS0002" &&
      clientiBriefing.counts.projects === 1 &&
      clientiBriefing.recentContext[0].projectName === "TuscanPledges" &&
      personaleBriefing.workspaceId === "WS0003" &&
      personaleBriefing.recentContext[0].projectName === "Registro Ore",
      "I briefing espliciti non isolano CLIENTI e PERSONALE."
    );
    assertWorkspaceFoundation(
      tuscanBriefing.scope === CONFIG.WORKSPACE_SCOPE.PROJECT &&
      tuscanBriefing.counts.projects === 1 &&
      tuscanBriefing.recentContext[0].projectId === "PRJ-TUSCAN" &&
      tuscanBriefing.recentContext[0].openTasks[0].taskId === "TSK-TUSCAN" &&
      tuscanBriefing.recentContext[0].lastUpdate.text === "Evento TuscanPledges",
      "Il briefing progetto non filtra progetto, task o Timeline."
    );
    assertWorkspaceFoundation(
      oreBriefing.scope === CONFIG.WORKSPACE_SCOPE.PROJECT &&
      oreBriefing.recentContext[0].projectId === "PRJ-ORE" &&
      scannerBriefing.scope === CONFIG.WORKSPACE_SCOPE.PROJECT &&
      scannerBriefing.recentContext[0].projectId === "PRJ-SCANNER",
      "La risoluzione per nome progetto non è completa."
    );
    assertWorkspaceFoundation(
      workspaceBeforeProject.scope === CONFIG.WORKSPACE_SCOPE.WORKSPACE &&
      workspaceBeforeProject.workspaces[0].id === "WS0002" &&
      workspaceBeforeProject.projects.length === 0,
      "La risoluzione progetto precede erroneamente quella workspace."
    );
    assertWorkspaceFoundation(
      defaultBriefing.recentContext.map(project => project.projectId).join(",") ===
      "PRJ-SCANNER,PRJ-IN-PROGRESS-OLD,PRJ-IN-PROGRESS-NEW,PRJ-WAITING,PRJ-BLOCKED,PRJ-DONE",
      "L'ordinamento operativo del briefing non è corretto."
    );
    assertWorkspaceFoundation(
      defaultBriefing.recentContext.find(project => (
        project.projectId === "PRJ-IN-PROGRESS-OLD"
      )).lastUpdate.text ===
      "Ultimo evento disponibile",
      "L'ultimo aggiornamento Timeline non è esposto."
    );
    const completedContext = defaultBriefing.recentContext.find(project => (
      project.projectId === "PRJ-DONE"
    ));
    assertWorkspaceFoundation(
      completedContext.nextAction === "" &&
      completedContext.lastUpdate.date === "" &&
      completedContext.lastUpdate.text === "",
      "Un progetto senza nextAction o Timeline non è gestito correttamente."
    );

    let unknownRejected = false;
    try {
      DeskEngine.getWorkspaceBriefing("Progetto inesistente");
    } catch (error) {
      unknownRejected = error.message.indexOf(
        "Workspace o progetto non trovato"
      ) !== -1;
    }
    assertWorkspaceFoundation(
      unknownRejected,
      "Un target che non è workspace né progetto non viene rifiutato."
    );

    return {
      success: true,
      defaultWorkspace: defaultBriefing.workspace,
      explicitWorkspace: clientiBriefing.workspaceId,
      projectResolution: tuscanBriefing.recentContext[0].projectId
    };
  } finally {
    WorkspaceService.list = originalWorkspaceList;
    WorkspaceService.getDefault = originalWorkspaceDefault;
    WorkspaceService.resolve = originalWorkspaceResolve;
    WorkspaceService.resolveByName = originalWorkspaceResolveByName;
    WorkspaceService.resolveForAssignment = originalWorkspaceResolveForAssignment;
    ProjectRepository.append = originalAppend;
    addTimeline = originalAddTimeline;
    ProjectService.listAll = originalProjectListAll;
    TaskService.listOpen = originalTaskListOpen;
    TimelineRepository.list = originalTimelineList;
  }
}

function workspaceFoundationProject(
  id, workspace, status, updatedAt, nextAction, name
) {
  return {
    id: id,
    name: name || id,
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
