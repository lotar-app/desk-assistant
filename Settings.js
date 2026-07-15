/**
 * DESK ENGINE
 * Configurazione centrale
 */

const CONFIG = {
  SHEETS: {
    PROJECTS: "Projects",
    TASKS: "Tasks",
    TIMELINE: "Timeline",
    SETTINGS: "Settings",
    MIGRATION_LOG: "MigrationLog"
  },

  PROJECT_COLUMNS: {
    ID: 1,
    NAME: 2,
    STATUS: 3,
    FOCUS: 4,
    OWNER: 5,
    NEXT_ACTION: 6,
    CREATED_AT: 7,
    UPDATED_AT: 8,
    WORKSPACE: 9
  },

  SETTINGS_COLUMNS: {
    KEY: 1,
    VALUE: 2
  },

  TASK_COLUMNS: {
    ID: 1,
    PROJECT_ID: 2,
    TITLE: 3,
    DESCRIPTION: 4,
    STATUS: 5,
    PRIORITY: 6,
    ASSIGNEE: 7,
    DUE_DATE: 8,
    CREATED_AT: 9,
    UPDATED_AT: 10,
    COMPLETED_AT: 11
  },

  PROJECT_STATUS: {
    IN_PROGRESS: "IN_PROGRESS",
    WAITING: "WAITING",
    PAUSED: "PAUSED",
    BLOCKED: "BLOCKED",
    COMPLETED: "COMPLETED"
  },

  TASK_STATUS: {
    OPEN: "Aperta",
    COMPLETED: "Completata"
  },

  TASK_PRIORITY: {
    NORMAL: "Normale"
  },

  DEFAULT_OWNER: "Max",
  DEFAULT_WORKSPACE: "LOTAR"
};
