function testProjectActivityTimelineSink() {
  const rows = [];
  const registryRows = {};
  let failMarkOnce = false;
  const projects = { getById: function(id) { return id === "PRJ-LOTAR" ? { id: id } : null; } };
  const timeline = {
    appendEvent: function(event) { rows.push(event); return rows.length + 1; },
    nextRowNumber: function() { return rows.length + 2; },
    getEventAtRow: function(rowNumber) {
      const event = rows[Number(rowNumber) - 2];
      return event ? Object.assign({ layout: "CANONICAL_V1" }, event) : null;
    }
  };
  const deliveryRegistry = {
    findByEventId: function(id) { return registryRows[id] || null; },
    createPending: function(record) {
      registryRows[record.eventId] = Object.assign({}, record, { status: "PENDING" });
    },
    updatePendingTimelineRow: function(id, timelineRow) {
      registryRows[id].timelineRow = timelineRow;
    },
    markDelivered: function(id, timelineRow) {
      if (failMarkOnce) { failMarkOnce = false; throw new Error("fixture response loss"); }
      registryRows[id].status = "DELIVERED";
      registryRows[id].timelineRow = timelineRow;
    }
  };
  const lock = { held: false,
    tryLock: function() { if (this.held) return false; this.held = true; return true; },
    releaseLock: function() { this.held = false; } };
  const dependencies = { timeline: timeline, deliveryRegistry: deliveryRegistry,
    projects: projects, lock: lock };
  const input = { eventId: "EVT-FIXTURE", projectId: "PRJ-LOTAR",
    activityId: "ACT-FIXTURE", eventType: "PROJECT_ACTIVITY_UPDATED",
    description: "fixture-only", createdAt: "2026-09-04T12:00:00.000Z" };

  const first = appendProjectActivityTimelineEvent(input, dependencies);
  const replay = appendProjectActivityTimelineEvent(input, dependencies);
  assertProjectActivityOutbox(first.created && !replay.created && replay.idempotentReplay,
    "Retry idempotente non valido.");
  assertProjectActivityOutbox(rows.length === 1, "Retry ha duplicato Timeline.");
  assertProjectActivityOutbox(rows[0].id === "ACT-FIXTURE" && rows[0].taskId === "" &&
    rows[0].eventType === "PROJECT_ACTIVITY_UPDATED" &&
    rows[0].description === "fixture-only" && rows[0].author === "PROJECT_ACTIVITY",
  "Mapping canonico ProjectActivity errato.");

  let conflict = null;
  try { appendProjectActivityTimelineEvent(Object.assign({}, input,
    { description: "different" }), dependencies); } catch (error) { conflict = error; }
  assertProjectActivityOutbox(conflict && conflict.code === "TIMELINE_EVENT_CONFLICT",
    "Conflitto fingerprint non rilevato.");

  const responseLossInput = Object.assign({}, input, { eventId: "EVT-LOSS" });
  failMarkOnce = true;
  try { appendProjectActivityTimelineEvent(responseLossInput, dependencies); } catch (_error) {}
  const reconciled = appendProjectActivityTimelineEvent(responseLossInput, dependencies);
  assertProjectActivityOutbox(reconciled.reconciled && rows.length === 2,
    "Response loss non riconciliata senza duplicato.");

  let missingRegistry = null;
  try { appendProjectActivityTimelineEvent(input, Object.assign({}, dependencies,
    { deliveryRegistry: { findByEventId: function() {
      throw timelineDeliveryRegistryError("TIMELINE_DELIVERY_REGISTRY_MISSING");
    } } })); } catch (error) { missingRegistry = error; }
  assertProjectActivityOutbox(missingRegistry &&
    missingRegistry.code === "TIMELINE_DELIVERY_REGISTRY_MISSING",
  "Registro mancante non fallisce chiuso.");

  const legacy = TimelineRepository.fromRow([
    new Date(0), "PRJ-LOTAR", "PROJECT_UPDATED", "fixture-only", "", "", ""
  ]);
  const canonical = TimelineRepository.fromRow([
    "PRJ-LOTAR", "PRJ-LOTAR", "", new Date(0), "PROJECT_UPDATED",
    "fixture-only", "SYSTEM"
  ]);
  assertProjectActivityOutbox(legacy.layout === "LEGACY_V0" &&
    legacy.type === "PROJECT_UPDATED" && legacy.description === "fixture-only",
  "Riga legacy sotto header canonici non leggibile.");
  assertProjectActivityOutbox(canonical.layout === "CANONICAL_V1" &&
    canonical.timestamp.getTime() === 0 && canonical.author === "SYSTEM",
  "Riga canonica non leggibile.");
  return { success: true, rows: rows.length };
}

function testProjectActivityTimelineEventIdMigration() {
  let superseded = null;
  try { TimelineEventIdMigration.createManifest({}); } catch (error) { superseded = error; }
  assertProjectActivityOutbox(superseded &&
    String(superseded.message).indexOf("SUPERSEDED") !== -1,
  "TimelineEventIdMigration è ancora applicabile.");
  return { success: true, migrationId: TimelineEventIdMigration.MIGRATION_ID };
}

function assertProjectActivityOutbox(condition, message) {
  if (!condition) throw new Error(message);
}
