const ProjectActivityTimelineDeliveryMigration = {
  MIGRATION_ID: "PROJECT_ACTIVITY_TIMELINE_DELIVERY_V1",
  MIGRATION_TYPE: "STRUCTURAL",
  EXECUTION_MODE: "EXECUTION_APPROVED",

  createManifest(dataSource) {
    dataSource = dataSource || MigrationDataSource.forSpreadsheet(
      SpreadsheetApp.getActiveSpreadsheet()
    );
    const current = dataSource.readSheet(
      CONFIG.SHEETS.PROJECT_ACTIVITY_TIMELINE_DELIVERY
    );
    if (current.exists) throw new Error("TIMELINE_DELIVERY_REGISTRY_ALREADY_EXISTS");
    return MigrationManifest.prepare({
      migrationId: this.MIGRATION_ID,
      version: "1",
      migrationType: this.MIGRATION_TYPE,
      mode: this.EXECUTION_MODE,
      baseline: { sheets: {
        ProjectActivityTimelineDelivery: {
          recordCount: 0,
          requiredHeaders: []
        }
      } },
      operations: [{
        operationId: "CREATE-PROJECT-ACTIVITY-TIMELINE-DELIVERY",
        action: "CREATE_SHEET",
        sheet: CONFIG.SHEETS.PROJECT_ACTIVITY_TIMELINE_DELIVERY,
        after: { headers: PROJECT_ACTIVITY_TIMELINE_DELIVERY_HEADERS },
        reason: "Crea il registro tecnico idempotente separato dalla Timeline."
      }]
    });
  }
};
