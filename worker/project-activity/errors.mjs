export class ProjectActivityError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = "ProjectActivityError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function activityError(code, details) {
  const definitions = {
    ACTIVITY_NOT_FOUND: [404, "Project activity not found."],
    AMBIGUOUS_ACTIVITY: [409, "The activity alias matches multiple projects."],
    PROJECT_NOT_FOUND: [404, "Project not found."],
    INVALID_MODE: [400, "Mode must be COMPACT, FULL, or KEYS."],
    INVALID_KEYS: [400, "KEYS mode requires a non-empty array of unique keys."],
    INVALID_PATCH: [400, "ProjectActivity core patch is invalid."],
    INVALID_ITEM_OPERATION: [400, "ProjectActivity item operation is invalid."],
    INVALID_ITEM_TYPE: [400, "ProjectActivity item type is invalid."],
    SNAPSHOT_VERSION_CONFLICT: [409, "ProjectActivity snapshot version is stale."],
    IDEMPOTENCY_CONFLICT: [409, "Idempotency key was already used with a different payload."],
    ALIAS_CONFLICT: [409, "ProjectActivity alias belongs to another activity."],
    D1_NOT_CONFIGURED: [503, "ProjectActivity D1 binding is not configured."],
    INTERNAL_ERROR: [500, "Unable to read ProjectActivity data."]
  };
  const [status, message] = definitions[code] || definitions.INTERNAL_ERROR;
  return new ProjectActivityError(code, message, status, details);
}
