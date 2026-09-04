/**
 * TIMELINE SERVICE
 */

function addTimeline(projectId, type, text, options) {
  options = options || {};
  return TimelineRepository.appendLegacy({
    projectId: projectId, timestamp: options.timestamp || new Date(),
    eventType: type, description: text
  });
}

function appendProjectActivityTimelineEvent(input, dependencies) {
  dependencies = dependencies || {
    timeline: TimelineRepository,
    deliveryRegistry: ProjectActivityTimelineDeliveryRepository,
    projects: ProjectRepository,
    lock: LockService.getDocumentLock()
  };
  const eventId = String(input && input.eventId || "").trim();
  const projectId = String(input && input.projectId || "").trim();
  const eventType = String(input && input.eventType || "").trim();
  const description = String(input && input.description || "").trim();
  if (!eventId || !projectId || !description) {
    throw timelineSinkError("INVALID_TIMELINE_EVENT");
  }
  if (!dependencies.lock.tryLock(30000)) {
    throw timelineSinkError("TIMELINE_LOCK_UNAVAILABLE");
  }
  try {
    const createdAt = input.createdAt ? new Date(input.createdAt) : new Date();
    if (isNaN(createdAt.getTime())) throw timelineSinkError("INVALID_TIMELINE_EVENT");
    const event = { id: String(input.activityId || "").trim(), projectId: projectId,
      taskId: "", timestamp: createdAt, eventType: eventType,
      description: description, author: "PROJECT_ACTIVITY" };
    const fingerprint = timelineEventFingerprint(event);
    const existing = dependencies.deliveryRegistry.findByEventId(eventId);
    if (existing) {
      if (String(existing.fingerprint) !== fingerprint) {
        throw timelineSinkError("TIMELINE_EVENT_CONFLICT");
      }
      if (existing.status === "DELIVERED") {
        return { success: true, eventId: eventId, created: false,
          idempotentReplay: true };
      }
      const reservedEvent = dependencies.timeline.getEventAtRow(existing.timelineRow);
      if (reservedEvent && reservedEvent.layout === "CANONICAL_V1" &&
          timelineEventFingerprint(reservedEvent) === fingerprint) {
        dependencies.deliveryRegistry.markDelivered(eventId, existing.timelineRow);
        return { success: true, eventId: eventId, created: false,
          idempotentReplay: true, reconciled: true };
      }
      dependencies.deliveryRegistry.updatePendingTimelineRow(
        eventId, dependencies.timeline.nextRowNumber()
      );
    } else {
      dependencies.deliveryRegistry.createPending({ eventId: eventId,
        projectId: projectId, fingerprint: fingerprint,
        timelineRow: dependencies.timeline.nextRowNumber(), createdAt: new Date() });
    }
    if (!dependencies.projects.getById(projectId)) {
      throw timelineSinkError("PROJECT_NOT_FOUND");
    }
    const pending = dependencies.deliveryRegistry.findByEventId(eventId);
    const timelineRow = dependencies.timeline.appendEvent(event);
    if (Number(pending.timelineRow) !== Number(timelineRow)) {
      throw timelineSinkError("TIMELINE_ROW_RESERVATION_CONFLICT");
    }
    dependencies.deliveryRegistry.markDelivered(eventId, timelineRow);
    return { success: true, eventId: eventId, created: true };
  } finally {
    dependencies.lock.releaseLock();
  }
}

function timelineSinkError(code) {
  const messages = {
    INVALID_TIMELINE_EVENT: "Evento Timeline non valido.",
    PROJECT_NOT_FOUND: "Progetto non trovato.",
    TIMELINE_LOCK_UNAVAILABLE: "Timeline temporaneamente occupata.",
    TIMELINE_EVENT_CONFLICT: "EventId già registrato con contenuto incompatibile.",
    TIMELINE_ROW_RESERVATION_CONFLICT: "Prenotazione riga Timeline non coerente."
  };
  const error = new Error(messages[code] || code);
  error.code = code;
  return error;
}

function timelineEventFingerprint(event) {
  const timestamp = event.timestamp instanceof Date
    ? event.timestamp.toISOString() : new Date(event.timestamp).toISOString();
  const canonical = JSON.stringify([
    String(event.id || ""), String(event.projectId || ""),
    String(event.taskId || ""), timestamp, String(event.eventType || ""),
    String(event.description || ""), String(event.author || "")
  ]);
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, canonical, Utilities.Charset.UTF_8
  );
  return digest.map(function(byte) {
    return (byte < 0 ? byte + 256 : byte).toString(16).padStart(2, "0");
  }).join("");
}

function getLatestTimeline(projectId, limit) {

  return TimelineRepository.latestByProject(projectId, limit || 5);

}

function getTimelineEvents() {

  return TimelineRepository.list();

}
