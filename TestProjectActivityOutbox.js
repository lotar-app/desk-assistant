function testProjectActivityTimelineSink() {
  const rows = [];
  const projects = { getById: function(id) { return id === "PRJ-LOTAR" ? { id: id } : null; } };
  const timeline = {
    findByEventId: function(eventId) {
      return rows.filter(function(row) { return row.eventId === eventId; })[0] || null;
    },
    append: function(row) {
      rows.push({ projectId: row[1], type: row[2], description: row[3], eventId: row[4] });
    }
  };
  const lock = {
    held: false,
    tryLock: function() { if (this.held) return false; this.held = true; return true; },
    releaseLock: function() { this.held = false; }
  };
  const dependencies = { timeline: timeline, projects: projects, lock: lock };
  const input = {
    eventId: "EVT-FIXTURE", projectId: "PRJ-LOTAR", activityId: "ACT-BW",
    eventType: "PROJECT_ACTIVITY_UPDATED", description: "fixture-only",
    createdAt: "2026-09-04T12:00:00.000Z"
  };
  const first = appendProjectActivityTimelineEvent(input, dependencies);
  const replay = appendProjectActivityTimelineEvent(input, dependencies);
  assertProjectActivityOutbox(first.created === true, "La prima delivery non crea la riga.");
  assertProjectActivityOutbox(replay.created === false && replay.idempotentReplay === true,
    "Il retry non è idempotente.");
  assertProjectActivityOutbox(rows.length === 1, "Il retry ha duplicato Timeline.");

  let conflict = null;
  try {
    appendProjectActivityTimelineEvent(Object.assign({}, input, { description: "different" }), dependencies);
  } catch (error) { conflict = error; }
  assertProjectActivityOutbox(conflict && conflict.code === "TIMELINE_EVENT_CONFLICT",
    "Il conflitto EventId non è stato rilevato.");
  assertProjectActivityOutbox(rows.length === 1, "Il conflitto ha scritto una riga.");

  let missingProject = null;
  try {
    appendProjectActivityTimelineEvent(Object.assign({}, input, {
      eventId: "EVT-MISSING", projectId: "PRJ-MISSING"
    }), dependencies);
  } catch (error) { missingProject = error; }
  assertProjectActivityOutbox(missingProject && missingProject.code === "PROJECT_NOT_FOUND",
    "Il progetto inesistente non è stato rifiutato.");
  assertProjectActivityOutbox(rows.length === 1, "È stato auto-creato o scritto un progetto inesistente.");

  const legacy = TimelineRepository.fromRow([new Date(), "PRJ-LOTAR", "LEGACY", "fixture-only"]);
  const current = TimelineRepository.fromRow([new Date(), "PRJ-LOTAR", "NEW", "fixture-only", "EVT-NEW"]);
  assertProjectActivityOutbox(legacy.eventId === null, "Una riga storica non è leggibile.");
  assertProjectActivityOutbox(current.eventId === "EVT-NEW", "EventId nuova riga non leggibile.");
  return { success: true, rows: rows.length };
}

function testProjectActivityTimelineEventIdMigration() {
  const rows = [{ rowNumber: 2, values: {
    Data: new Date(0), "Project ID": "PRJ-LOTAR", Tipo: "LEGACY",
    Descrizione: "fixture-only"
  } }];
  const manifest = TimelineEventIdMigration.createManifest({
    readSheet: function() {
      return { exists: true, headers: TIMELINE_HEADERS.slice(), rows: rows };
    }
  });
  MigrationManifest.validate(manifest);
  const operation = manifest.operations[0];
  assertProjectActivityOutbox(operation.action === "ADD_COLUMN", "Migrazione non append-only.");
  assertProjectActivityOutbox(operation.after.header === "EventId", "Header EventId mancante.");
  assertProjectActivityOutbox(operation.after.position === 5, "Posizione EventId non sicura.");
  const spreadsheet = createMigrationTestSpreadsheet({
    Timeline: [
      ["Data", "Project ID", "Tipo", "Descrizione"],
      [new Date(0), "PRJ-LOTAR", "LEGACY", "fixture-only"]
    ]
  });
  MigrationWriter.apply(spreadsheet, operation);
  const values = spreadsheet.getSheetByName("Timeline").getDataRange().getValues();
  assertProjectActivityOutbox(values[0][4] === "EventId", "Colonna EventId non aggiunta.");
  assertProjectActivityOutbox(values[1][0].getTime() === 0 && values[1][3] === "fixture-only",
    "La migrazione ha alterato la riga storica.");
  assertProjectActivityOutbox(values[1][4] === "", "La riga storica non è nullable.");
  return { success: true, migrationId: manifest.migrationId };
}

function assertProjectActivityOutbox(condition, message) {
  if (!condition) throw new Error(message);
}
