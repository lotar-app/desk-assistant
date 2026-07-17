function testConversationEngine() {

  return ConversationEngine.processConversationUpdate(
    "Aggiornamento sito web",
    {
      summary: "Aggiornamento pagina Cucine d'Autore.",
      focus: "Specificare che il servizio è disponibile esclusivamente in Toscana.",
      nextAction: "Aggiornare la pagina del sito.",
      status: "IN_PROGRESS",
      newTasks: [
        "Aggiornare la pagina Cucine d'Autore indicando che il servizio è disponibile solo in Toscana."
      ],
      completedTasks: [],
      timelineEvent: "Avviato aggiornamento pagina Cucine d'Autore."
    }
  );

}

function testConversationEnginePersistsPausedStatus() {

  const originalFindByName = ProjectService.findByName;
  const originalGetById = ProjectRepository.getById;
  const originalUpdate = ProjectRepository.update;
  const originalAddTimeline = addTimeline;
  const project = {
    id: "PRJ-SCANNER",
    name: "Scanner di rete",
    status: CONFIG.PROJECT_STATUS.IN_PROGRESS,
    focus: "Scansione rete",
    nextAction: "Riprendere la scansione",
    workspaceId: "WS0001"
  };
  let savedUpdate = null;
  let timelineEvent = null;

  try {

    ProjectService.findByName = function() {
      return project;
    };

    ProjectRepository.getById = function() {
      return project;
    };

    ProjectRepository.update = function(id, data) {
      savedUpdate = data;
      project.status = data.status;
      return id === project.id;
    };

    addTimeline = function(projectId, type, description) {
      timelineEvent = {
        projectId: projectId,
        type: type,
        description: description
      };
    };

    ConversationEngine.processConversationUpdate("Scanner di rete", {
      summary: "Progetto messo in standby.",
      status: "PAUSED",
      newTasks: [],
      completedTasks: [],
      timelineEvent: "Progetto messo in standby"
    });

    assertConversationEngine(
      savedUpdate && savedUpdate.status === CONFIG.PROJECT_STATUS.PAUSED,
      "Lo status PAUSED non raggiunge il repository Projects."
    );
    assertConversationEngine(
      project.status === CONFIG.PROJECT_STATUS.PAUSED,
      "Il progetto conserva lo status precedente."
    );
    assertConversationEngine(
      timelineEvent && timelineEvent.projectId === project.id,
      "La Timeline non viene aggiornata nella stessa operazione logica."
    );

    return {
      success: true,
      status: project.status,
      timelineEvent: timelineEvent.description
    };

  } finally {

    ProjectService.findByName = originalFindByName;
    ProjectRepository.getById = originalGetById;
    ProjectRepository.update = originalUpdate;
    addTimeline = originalAddTimeline;

  }

}

function testProjectStatusAliases() {

  assertConversationEngine(
    normalizeProjectStatus("PAUSED") === CONFIG.PROJECT_STATUS.PAUSED,
    "PAUSED non viene riconosciuto."
  );
  assertConversationEngine(
    normalizeProjectStatus("In pausa") === CONFIG.PROJECT_STATUS.PAUSED,
    "L'alias In pausa non viene convertito in PAUSED."
  );
  assertConversationEngine(
    normalizeProjectStatus("DONE") === CONFIG.PROJECT_STATUS.COMPLETED,
    "DONE non viene convertito in COMPLETED."
  );

  return { success: true };

}

function testWorkspaceBriefing() {

  const originalProjectListAll = ProjectRepository.listAll;
  const originalTaskList = TaskRepository.list;
  const originalTimelineList = TimelineRepository.list;
  const reads = {
    projects: 0,
    tasks: 0,
    timeline: 0
  };

  ProjectRepository.listAll = function() {
    reads.projects++;
    return originalProjectListAll.call(ProjectRepository);
  };

  TaskRepository.list = function() {
    reads.tasks++;
    return originalTaskList.call(TaskRepository);
  };

  TimelineRepository.list = function() {
    reads.timeline++;
    return originalTimelineList.call(TimelineRepository);
  };

  try {

    const startedAt = Date.now();
    const response = ConversationEngine.getWorkspaceBriefing();
    const elapsedMs = Date.now() - startedAt;

    assertWorkspaceBriefing(response.success === true, "Risposta non riuscita.");
    assertWorkspaceBriefing(!!response.briefing, "Briefing mancante.");
    assertWorkspaceBriefing(
      Array.isArray(response.briefing.recentContext),
      "recentContext non valido."
    );
    assertWorkspaceBriefing(
      Array.isArray(response.briefing.candidateStartingPoints),
      "candidateStartingPoints non valido."
    );
    assertWorkspaceBriefing(reads.projects === 1, "Projects letto più di una volta.");
    assertWorkspaceBriefing(reads.tasks === 1, "Tasks letto più di una volta.");
    assertWorkspaceBriefing(reads.timeline === 1, "Timeline letta più di una volta.");
    assertWorkspaceBriefing(elapsedMs < 2000, "Briefing oltre il limite di 2 secondi.");

    JSON.stringify(response);

    return {
      success: true,
      elapsedMs: elapsedMs,
      reads: reads
    };

  } finally {

    ProjectRepository.listAll = originalProjectListAll;
    TaskRepository.list = originalTaskList;
    TimelineRepository.list = originalTimelineList;

  }

}

function testWorkspaceBriefingApi() {

  const response = doPost({
    postData: {
      contents: JSON.stringify({
        token: DESK_API_TOKEN,
        action: "getWorkspaceBriefing"
      })
    }
  });
  const data = JSON.parse(response.getContent());

  assertWorkspaceBriefing(data.success === true, "Routing API non riuscito.");
  assertWorkspaceBriefing(!!data.briefing, "Briefing API mancante.");

  return data;

}

function testWorkspaceBriefingApiRouting() {

  const originalBriefing = ConversationEngine.getWorkspaceBriefing;
  const captured = [];

  try {

    ConversationEngine.getWorkspaceBriefing = function(request) {
      captured.push(request);
      return { success: true, briefing: { recentContext: [] } };
    };

    const defaultResponse = doPost({
      postData: {
        contents: JSON.stringify({
          token: DESK_API_TOKEN,
          action: "getWorkspaceBriefing"
        })
      }
    });

    const response = doPost({
      postData: {
        contents: JSON.stringify({
          token: DESK_API_TOKEN,
          action: "getWorkspaceBriefing",
          scope: "WORKSPACE",
          workspace: "TP"
        })
      }
    });
    const data = JSON.parse(response.getContent());

    assertWorkspaceBriefing(
      JSON.parse(defaultResponse.getContent()).success === true &&
      data.success === true,
      "Routing API non riuscito."
    );
    assertWorkspaceBriefing(
      captured.length === 2 &&
      captured[0].scope === undefined &&
      captured[0].workspaceId === undefined &&
      captured[0].workspace === undefined &&
      captured[1].scope === "WORKSPACE" &&
      captured[1].workspace === "TP",
      "L'API non inoltra scope e workspace al ConversationEngine."
    );

    return { success: true, requests: captured };

  } finally {

    ConversationEngine.getWorkspaceBriefing = originalBriefing;

  }

}

function assertWorkspaceBriefing(condition, message) {

  if (!condition) {
    throw new Error(message);
  }

}

function assertConversationEngine(condition, message) {

  if (!condition) {
    throw new Error(message);
  }

}
