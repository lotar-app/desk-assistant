function testTimelineCanonicalModel() {
  const physicalRows = [];
  const originalAppend = TimelineRepository.append;
  TimelineRepository.append = function(row, headers) {
    physicalRows.push({ row: row, headers: headers });
    return physicalRows.length + 1;
  };
  try {
    TimelineRepository.appendLegacy({ timestamp: new Date(0), projectId: "PRJ-1",
      eventType: "PROJECT_CREATED", description: "fixture-only" });
    TimelineRepository.appendEvent({ id: "ACT-1", projectId: "PRJ-1", taskId: "",
      timestamp: new Date(1), eventType: "PROJECT_ACTIVITY_CREATED",
      description: "canonical-activity", author: "PROJECT_ACTIVITY" });
  } finally {
    TimelineRepository.append = originalAppend;
  }
  assertCanonicalTimeline(physicalRows[0].row.length === 4 &&
    physicalRows[0].headers === TIMELINE_HEADERS,
  "Writer legacy non produce esattamente A-D.");
  assertCanonicalTimeline(physicalRows[1].row.length === 7 &&
    physicalRows[1].headers === TIMELINE_CANONICAL_HEADERS &&
    physicalRows[1].row[0] === "ACT-1" && physicalRows[1].row[2] === "" &&
    physicalRows[1].row[6] === "PROJECT_ACTIVITY" &&
    physicalRows[1].row.indexOf("EVT-FIXTURE") === -1,
  "Writer ProjectActivity non produce il mapping canonico atteso.");

  const legacyRows = [];
  const originalAppendLegacy = TimelineRepository.appendLegacy;
  TimelineRepository.appendLegacy = function(event) {
    legacyRows.push([
      event.timestamp, event.projectId, event.eventType, event.description
    ]);
    return legacyRows.length + 1;
  };
  try {
    addTimeline("PRJ-1", "PROJECT_CREATED", "fixture-only",
      { id: "PRJ-1", author: "SYSTEM", timestamp: new Date(0) });
    addTimeline("PRJ-1", "TASK_CREATED", "fixture-only",
      { id: "TSK-1", taskId: "TSK-1", author: "SYSTEM", timestamp: new Date(1) });
    addTimeline("PRJ-1", "MEMORY_EVENT", "fixture-only",
      { author: "CUSTOM_GPT", timestamp: new Date(2) });
  } finally {
    TimelineRepository.appendLegacy = originalAppendLegacy;
  }
  assertCanonicalTimeline(legacyRows.length === 3, "Writer legacy non invocato.");
  legacyRows.forEach(function(row) {
    assertCanonicalTimeline(row.length === 4,
      "Un writer Desk legacy ha valorizzato colonne E-G.");
  });
  assertCanonicalTimeline(legacyRows[0][0].getTime() === 0 &&
    legacyRows[0][1] === "PRJ-1" && legacyRows[0][2] === "PROJECT_CREATED" &&
    legacyRows[0][3] === "fixture-only", "Mapping Project legacy errato.");
  assertCanonicalTimeline(legacyRows[1][0].getTime() === 1 &&
    legacyRows[1][2] === "TASK_CREATED", "Mapping Task legacy errato.");
  assertCanonicalTimeline(legacyRows[2][0].getTime() === 2 &&
    legacyRows[2][2] === "MEMORY_EVENT", "Mapping memory legacy errato.");

  const projectCreate = String(ProjectService.create);
  const projectUpdate = String(ProjectService.update);
  const taskCreate = String(TaskService.create);
  const taskComplete = String(TaskService.complete);
  const memoryWriter = String(DeskEngine.applyPreparedUpdate);
  [projectCreate, projectUpdate, taskCreate, taskComplete, memoryWriter]
    .forEach(function(writer) {
      assertCanonicalTimeline(writer.indexOf("addTimeline(") !== -1,
        "Flusso Desk non instradato tramite adapter legacy.");
    });

  const legacyProject = TimelineRepository.fromRow([
    new Date(1), "PRJ-1", "PROJECT_UPDATED", "legacy-project", "", "", ""
  ]);
  const legacyTask = TimelineRepository.fromRow([
    new Date(2), "PRJ-1", "TASK_COMPLETED", "legacy-task", "", "", ""
  ]);
  const legacyMemory = TimelineRepository.fromRow([
    new Date(3), "PRJ-1", "MEMORY_EVENT", "legacy-memory", "", "", ""
  ]);
  const canonicalActivity = TimelineRepository.fromRow([
    "ACT-1", "PRJ-1", "", new Date(4), "PROJECT_ACTIVITY_UPDATED",
    "canonical-activity", "PROJECT_ACTIVITY"
  ]);
  const ambiguousTail = TimelineRepository.fromRow([
    new Date(5), "PRJ-1", "PROJECT_UPDATED", "legacy-with-tail", "", "", "SYSTEM"
  ]);
  assertCanonicalTimeline(legacyProject.layout === "LEGACY_V0" &&
    legacyTask.layout === "LEGACY_V0" && legacyMemory.layout === "LEGACY_V0",
  "Dataset legacy misto non riconosciuto.");
  assertCanonicalTimeline(canonicalActivity.layout === "CANONICAL_V1" &&
    canonicalActivity.id === "ACT-1" && canonicalActivity.taskId === "" &&
    canonicalActivity.author === "PROJECT_ACTIVITY",
  "Evento ProjectActivity canonico non riconosciuto.");
  assertCanonicalTimeline(ambiguousTail.layout === "LEGACY_V0",
    "Una coda canonica incompleta ha riclassificato una riga legacy.");

  const originalSheet = TimelineRepository.sheet;
  const rows = [TIMELINE_CANONICAL_HEADERS, [
    new Date(1), "PRJ-1", "PROJECT_UPDATED", "legacy-project", "", "", ""
  ], [new Date(6), "PRJ-2", "PROJECT_UPDATED", "other", "", "", ""], [
    "ACT-1", "PRJ-1", "", new Date(4), "PROJECT_ACTIVITY_UPDATED",
    "canonical-activity", "PROJECT_ACTIVITY"
  ]];
  TimelineRepository.sheet = function() {
    return { getDataRange: function() {
      return { getValues: function() { return rows.map(function(row) {
        return row.slice();
      }); } };
    } };
  };
  try {
    const mixed = TimelineRepository.listByProject("PRJ-1");
    const latest = TimelineRepository.latestByProject("PRJ-1", 1);
    assertCanonicalTimeline(mixed.length === 2 &&
      mixed[0].layout === "LEGACY_V0" && mixed[1].layout === "CANONICAL_V1",
    "Filtro progetto non supporta dataset misto.");
    assertCanonicalTimeline(latest.length === 1 &&
      latest[0].description === "canonical-activity",
    "Ordinamento dataset misto errato.");
    const serialized = serializeTimelineEvent(latest[0]);
    assertCanonicalTimeline(serialized.type === "PROJECT_ACTIVITY_UPDATED" &&
      serialized.description === "canonical-activity",
    "Serializzazione API/UI del dataset misto errata.");
    const detail = workspaceTimelineDetail(latest[0]);
    assertCanonicalTimeline(detail.type === "PROJECT_ACTIVITY_UPDATED" &&
      detail.description === "canonical-activity",
    "Workspace briefing non usa il modello Timeline normalizzato.");
    const originalProjects = ProjectRepository.listAll;
    const originalWorkspaces = WorkspaceRepository.listAll;
    const originalAliases = WorkspaceAliasRepository.listAll;
    const originalTasks = TaskRepository.list;
    ProjectRepository.listAll = function() { return [{ id: "PRJ-1" }]; };
    WorkspaceRepository.listAll = function() { return []; };
    WorkspaceAliasRepository.listAll = function() { return []; };
    TaskRepository.list = function() { return []; };
    try {
      const quality = WorkspaceDataQualityService.inspect();
      assertCanonicalTimeline(quality.orphanTimeline.length === 1 &&
        quality.orphanTimeline[0].projectId === "PRJ-2" &&
        quality.orphanTimeline[0].type === "PROJECT_UPDATED",
        "WorkspaceDataQuality non usa il modello Timeline normalizzato.");
    } finally {
      ProjectRepository.listAll = originalProjects;
      WorkspaceRepository.listAll = originalWorkspaces;
      WorkspaceAliasRepository.listAll = originalAliases;
      TaskRepository.list = originalTasks;
    }
  } finally {
    TimelineRepository.sheet = originalSheet;
  }
  return { success: true, events: legacyRows.length };
}

function assertCanonicalTimeline(condition, message) {
  if (!condition) throw new Error(message);
}
