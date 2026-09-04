const PROJECT_HEADERS = [
  "ID",
  "Progetto",
  "Status",
  "Focus",
  "Responsabile",
  "Prossima azione",
  "Creato il",
  "Ultimo aggiornamento",
  "WorkspaceID"
];

const WORKSPACE_HEADERS = [
  "ID",
  "Name",
  "IsDefault",
  "Status",
  "CreatedAt",
  "UpdatedAt"
];

const WORKSPACE_ALIAS_HEADERS = [
  "Alias",
  "WorkspaceID",
  "CreatedAt"
];

const SETTINGS_HEADERS = [
  "Key",
  "Value"
];

const TIMELINE_HEADERS = [
  "Data",
  "Project ID",
  "Tipo",
  "Descrizione"
];

const TIMELINE_CANONICAL_HEADERS = [
  "ID", "Project ID", "TaskID", "Timestamp",
  "EventType", "Description", "Author"
];

const PROJECT_ACTIVITY_TIMELINE_DELIVERY_HEADERS = [
  "EventId", "ProjectId", "Fingerprint", "TimelineRow", "CreatedAt", "Status"
];

const TASK_HEADERS = [
  "ID",
  "ProjectID",
  "Title",
  "Description",
  "Status",
  "Priority",
  "Assignee",
  "DueDate",
  "CreatedAt",
  "UpdatedAt",
  "CompletedAt"
];

const MIGRATION_LOG_HEADERS = [
  "MigrationID",
  "Sequence",
  "OperationID",
  "Action",
  "Sheet",
  "Status",
  "Before",
  "After",
  "Message",
  "RecordedAt",
  "EntryChecksum"
];
