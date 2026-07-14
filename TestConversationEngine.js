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

function assertWorkspaceBriefing(condition, message) {

  if (!condition) {
    throw new Error(message);
  }

}
