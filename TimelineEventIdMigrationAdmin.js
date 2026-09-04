function timelineEventIdMigrationPreflight(dependencies) {
  dependencies = dependencies || timelineEventIdMigrationDependencies_();
  const dataSource = dependencies.dataSource;
  const timeline = dataSource.readSheet(CONFIG.SHEETS.TIMELINE);
  const compatible = timeline.exists === true && MigrationUtils.valuesEqual(
    timeline.headers, TIMELINE_HEADERS
  );
  return { success: compatible, migrationId: TimelineEventIdMigration.MIGRATION_ID,
    migrationType: TimelineEventIdMigration.MIGRATION_TYPE,
    executionMode: TimelineEventIdMigration.EXECUTION_MODE,
    recordCount: timeline.rows.length, headers: timeline.headers,
    error: compatible ? null : "TIMELINE_SCHEMA_INCOMPATIBLE" };
}

function timelineEventIdMigrationDryRun(dependencies) {
  dependencies = dependencies || timelineEventIdMigrationDependencies_();
  const dataSource = dependencies.dataSource;
  const manifest = TimelineEventIdMigration.createManifest(dataSource);
  const backup = BackupEngine.create(dataSource, manifest);
  const dryRun = DryRunEngine.run(manifest, backup);
  return { success: dryRun.success === true, migrationId: manifest.migrationId,
    migrationType: manifest.migrationType, executionMode: manifest.mode,
    recordCount: backup.sheets.Timeline.rows.length,
    backupChecksum: backup.checksum,
    manifestChecksum: dryRun.manifestChecksum,
    manifestSignature: dryRun.manifestSignature,
    operations: dryRun.operations.map(function(operation) {
      return { operationId: operation.operationId, action: operation.action,
        sheet: operation.sheet, valid: operation.valid, reason: operation.reason };
    }) };
}

function timelineEventIdMigrationCreatePhysicalBackup(folderId, dependencies) {
  dependencies = dependencies || timelineEventIdMigrationDependencies_();
  const dataSource = dependencies.dataSource;
  const manifest = TimelineEventIdMigration.createManifest(dataSource);
  const backup = BackupEngine.create(dataSource, manifest);
  return BackupEngine.createPhysical(backup, manifest, {
    folderId: folderId, services: dependencies.backupServices
  });
}

function timelineEventIdMigrationApply(confirmation, physicalBackup, dependencies) {
  dependencies = dependencies || timelineEventIdMigrationDependencies_();
  const dataSource = dependencies.dataSource;
  const manifest = TimelineEventIdMigration.createManifest(dataSource);
  if (!confirmation || confirmation.phrase !==
      "APPLY " + TimelineEventIdMigration.MIGRATION_ID) {
    throw new Error("Conferma esplicita non valida.");
  }
  const backup = BackupEngine.create(dataSource, manifest);
  const dryRun = DryRunEngine.run(manifest, backup);
  return MigrationExecutor.execute(
    manifest, backup, dryRun, physicalBackup, confirmation,
    dependencies.execution
  );
}

function timelineEventIdMigrationPostCheck(expectedRecordCount, dependencies) {
  dependencies = dependencies || timelineEventIdMigrationDependencies_();
  const dataSource = dependencies.dataSource;
  const timeline = dataSource.readSheet(CONFIG.SHEETS.TIMELINE);
  const expectedHeaders = TIMELINE_HEADERS.concat(["EventId"]);
  const emptyHistoricalIds = timeline.rows.every(function(row) {
    return String(row.values.EventId || "").trim() === "";
  });
  const countMatches = Number(expectedRecordCount) === timeline.rows.length;
  return { success: timeline.exists === true && countMatches &&
      emptyHistoricalIds && MigrationUtils.valuesEqual(timeline.headers, expectedHeaders),
    migrationId: TimelineEventIdMigration.MIGRATION_ID,
    recordCount: timeline.rows.length, countMatches: countMatches,
    headersValid: MigrationUtils.valuesEqual(timeline.headers, expectedHeaders),
    historicalEventIdsEmpty: emptyHistoricalIds };
}

function timelineEventIdMigrationPrepareRollback(dependencies) {
  dependencies = dependencies || timelineEventIdMigrationDependencies_();
  const spreadsheet = dependencies.spreadsheet;
  assertTimelineEventIdRollbackSafe_(spreadsheet);
  const repository = dependencies.logRepository || MigrationLogRepository.create(spreadsheet);
  const log = repository.read(
    TimelineEventIdMigration.MIGRATION_ID
  );
  return RollbackEngine.buildPlan(log, { executable: true });
}

function timelineEventIdMigrationRollback(plan, confirmation, physicalBackup, dependencies) {
  dependencies = dependencies || timelineEventIdMigrationDependencies_();
  const spreadsheet = dependencies.spreadsheet;
  assertTimelineEventIdRollbackSafe_(spreadsheet);
  if (!confirmation || confirmation.phrase !==
      "ROLLBACK " + TimelineEventIdMigration.MIGRATION_ID) {
    throw new Error("Conferma esplicita di rollback non valida.");
  }
  return RollbackEngine.execute(plan, physicalBackup, confirmation,
    dependencies.rollback);
}

function assertTimelineEventIdRollbackSafe_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(CONFIG.SHEETS.TIMELINE);
  if (!sheet) throw new Error("TIMELINE_SCHEMA_INCOMPATIBLE");
  const values = sheet.getDataRange().getValues();
  const expectedHeaders = TIMELINE_HEADERS.concat(["EventId"]);
  if (!values.length || !MigrationUtils.valuesEqual(values[0], expectedHeaders)) {
    throw new Error("TIMELINE_SCHEMA_INCOMPATIBLE");
  }
  if (values.slice(1).some(function(row) {
    return String(row[4] || "").trim() !== "";
  })) {
    throw new Error("TIMELINE_EVENT_ID_ROLLBACK_NOT_SAFE");
  }
  return true;
}

function timelineEventIdMigrationDependencies_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  return {
    spreadsheet: spreadsheet,
    dataSource: MigrationDataSource.forSpreadsheet(spreadsheet),
    backupServices: null,
    execution: undefined
  };
}
