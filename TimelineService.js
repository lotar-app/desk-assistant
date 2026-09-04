/**
 * TIMELINE SERVICE
 */

function addTimeline(projectId, type, text) {

  TimelineRepository.append([
    new Date(),
    projectId,
    type,
    text
  ]);

}

function appendProjectActivityTimelineEvent(input, dependencies) {
  dependencies = dependencies || {
    timeline: TimelineRepository,
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
    const existing = dependencies.timeline.findByEventId(eventId);
    if (existing) {
      if (String(existing.projectId) !== projectId ||
          String(existing.type) !== eventType ||
          String(existing.description) !== description) {
        throw timelineSinkError("TIMELINE_EVENT_CONFLICT");
      }
      return { success: true, eventId: eventId, created: false, idempotentReplay: true };
    }
    if (!dependencies.projects.getById(projectId)) {
      throw timelineSinkError("PROJECT_NOT_FOUND");
    }
    const createdAt = input.createdAt ? new Date(input.createdAt) : new Date();
    if (isNaN(createdAt.getTime())) throw timelineSinkError("INVALID_TIMELINE_EVENT");
    dependencies.timeline.append([
      createdAt, projectId, eventType, description, eventId
    ]);
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
    TIMELINE_EVENT_CONFLICT: "EventId già registrato con contenuto incompatibile."
  };
  const error = new Error(messages[code] || code);
  error.code = code;
  return error;
}

function getLatestTimeline(projectId, limit) {

  return TimelineRepository.latestByProject(projectId, limit || 5);

}

function getTimelineEvents() {

  return TimelineRepository.list();

}
