const TimelineEventIdMigration = {
  MIGRATION_ID: "TIMELINE_EVENT_ID_V1",
  SUPERSEDED_BY: "PROJECT_ACTIVITY_TIMELINE_DELIVERY_V1",
  MIGRATION_TYPE: "STRUCTURAL",
  EXECUTION_MODE: "EXECUTION_APPROVED",

  createManifest(dataSource) {
    throw new Error(
      "TIMELINE_EVENT_ID_V1_SUPERSEDED: usare il registro tecnico separato."
    );
  },

  createHistoricalManifest(dataSource) {
    dataSource = dataSource || MigrationDataSource.forSpreadsheet(
      SpreadsheetApp.getActiveSpreadsheet()
    );
    const timeline = dataSource.readSheet(CONFIG.SHEETS.TIMELINE);
    if (!timeline.exists || !MigrationUtils.valuesEqual(
      timeline.headers, TIMELINE_HEADERS
    )) {
      throw new Error("TIMELINE_SCHEMA_INCOMPATIBLE");
    }
    return MigrationManifest.prepare({
      migrationId: this.MIGRATION_ID,
      version: "1",
      migrationType: this.MIGRATION_TYPE,
      mode: this.EXECUTION_MODE,
      baseline: {
        sheets: {
          Timeline: {
            recordCount: timeline.rows.length,
            requiredHeaders: TIMELINE_HEADERS
          }
        }
      },
      operations: [{
        operationId: "TIMELINE-ADD-EVENT-ID",
        action: "ADD_COLUMN",
        sheet: CONFIG.SHEETS.TIMELINE,
        after: { header: "EventId", position: 5 },
        reason: "Identificatore idempotente per la delivery ProjectActivity."
      }]
    });
  }
};
