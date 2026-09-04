function testTimelineEventIdMigrationAdmin() {
  const initialTimeline = [
    TIMELINE_HEADERS.slice(),
    [new Date(0), "PRJ-FIXTURE", "LEGACY", "fixture-only"]
  ];
  const spreadsheet = createMigrationTestSpreadsheet({
    Timeline: initialTimeline,
    MigrationLog: [MIGRATION_LOG_HEADERS.slice()]
  });
  const dataSource = MigrationDataSource.forSpreadsheet(spreadsheet);
  const baseDependencies = { spreadsheet: spreadsheet, dataSource: dataSource };

  const preflight = timelineEventIdMigrationPreflight(baseDependencies);
  assertTimelineMigrationAdmin(preflight.success, "Preflight legacy non valido.");
  assertTimelineMigrationAdmin(preflight.recordCount === 1, "Record count preflight errato.");

  let invalidSchema = null;
  try {
    TimelineEventIdMigration.createManifest({ readSheet: function() {
      return { exists: true, headers: ["Wrong"], rows: [] };
    } });
  } catch (error) { invalidSchema = error; }
  assertTimelineMigrationAdmin(!!invalidSchema, "Schema errato non bloccato.");

  const beforeDryRun = spreadsheet.getSheetByName("Timeline").getDataRange().getValues();
  const dryRun = timelineEventIdMigrationDryRun(baseDependencies);
  const afterDryRun = spreadsheet.getSheetByName("Timeline").getDataRange().getValues();
  assertTimelineMigrationAdmin(dryRun.success && dryRun.operations.length === 1,
    "Dry-run non valido.");
  assertTimelineMigrationAdmin(MigrationUtils.valuesEqual(beforeDryRun, afterDryRun),
    "Dry-run ha modificato Timeline.");

  const manifest = TimelineEventIdMigration.createManifest(dataSource);
  assertTimelineMigrationAdmin(manifest.migrationType === "STRUCTURAL",
    "Classificazione strutturale mancante.");
  assertTimelineMigrationAdmin(manifest.mode === "EXECUTION_APPROVED",
    "Execution mode non approvato.");
  const backup = BackupEngine.create(dataSource, manifest);
  assertTimelineMigrationAdmin(backup.readOnly && !!backup.checksum,
    "Backup logico non valido.");

  const copySpreadsheet = createMigrationTestSpreadsheet({
    Timeline: initialTimeline,
    MigrationLog: [MIGRATION_LOG_HEADERS.slice()]
  });
  const backupServices = migrationBackupTestServices(spreadsheet, copySpreadsheet);
  const physicalBackup = timelineEventIdMigrationCreatePhysicalBackup(null, {
    spreadsheet: spreadsheet, dataSource: dataSource, backupServices: backupServices
  });
  assertTimelineMigrationAdmin(physicalBackup.verified === true,
    "Backup fisico non verificato.");

  const prepared = MigrationManifest.prepare(manifest);
  const confirmation = { confirmed: true, migrationId: manifest.migrationId,
    checksum: prepared.checksum, signature: prepared.signature,
    backupChecksum: backup.checksum,
    phrase: "APPLY TIMELINE_EVENT_ID_V1" };
  const logRepository = MigrationLogRepository.create(spreadsheet);
  const lock = migrationTestLock();
  const executionDependencies = { dataSource: dataSource,
    writer: MigrationWriter.create(spreadsheet), logRepository: logRepository,
    lock: lock, spreadsheetId: spreadsheet.getId() };

  let badConfirmation = null;
  try {
    timelineEventIdMigrationApply(Object.assign({}, confirmation, { phrase: "APPLY" }),
      physicalBackup, { spreadsheet: spreadsheet, dataSource: dataSource,
        execution: executionDependencies });
  } catch (error) { badConfirmation = error; }
  assertTimelineMigrationAdmin(!!badConfirmation, "Conferma generica accettata.");

  const result = timelineEventIdMigrationApply(confirmation, physicalBackup, {
    spreadsheet: spreadsheet, dataSource: dataSource,
    execution: executionDependencies
  });
  assertTimelineMigrationAdmin(result.success, "Apply non riuscito.");
  const timeline = spreadsheet.getSheetByName("Timeline");
  const values = timeline.getDataRange().getValues();
  assertTimelineMigrationAdmin(values[0][4] === "EventId", "EventId non in colonna 5.");
  assertTimelineMigrationAdmin(values.length === initialTimeline.length,
    "Numero righe modificato.");
  assertTimelineMigrationAdmin(values[1][0].getTime() === 0 &&
    values[1][3] === "fixture-only" && values[1][4] === "",
    "Storico modificato.");
  const post = timelineEventIdMigrationPostCheck(1, {
    spreadsheet: spreadsheet, dataSource: dataSource
  });
  assertTimelineMigrationAdmin(post.success, "Post-check non valido.");
  assertTimelineMigrationAdmin(logRepository.read(manifest.migrationId).entries.some(
    function(entry) { return entry.status === "COMPLETED"; }), "Migration log incompleto.");

  let secondApply = null;
  try { TimelineEventIdMigration.createManifest(dataSource); } catch (error) { secondApply = error; }
  assertTimelineMigrationAdmin(!!secondApply, "Doppia applicazione non bloccata.");

  const rollbackDependencies = { spreadsheet: spreadsheet,
    logRepository: logRepository };
  const rollbackPlan = timelineEventIdMigrationPrepareRollback(rollbackDependencies);
  timeline.getRange(2, 5, 1, 1).setValues([["EVT-FIXTURE"]]);
  let unsafeRollback = null;
  try { timelineEventIdMigrationPrepareRollback(rollbackDependencies); }
  catch (error) { unsafeRollback = error; }
  assertTimelineMigrationAdmin(unsafeRollback &&
    unsafeRollback.message === "TIMELINE_EVENT_ID_ROLLBACK_NOT_SAFE",
    "Rollback con EventId valorizzato non bloccato.");
  timeline.getRange(2, 5, 1, 1).setValues([[""]]);
  const rollbackConfirmation = { confirmed: true,
    migrationId: manifest.migrationId, checksum: rollbackPlan.checksum,
    backupChecksum: physicalBackup.sourceChecksum,
    phrase: "ROLLBACK TIMELINE_EVENT_ID_V1" };
  const rollback = timelineEventIdMigrationRollback(
    rollbackPlan, rollbackConfirmation, physicalBackup,
    { spreadsheet: spreadsheet,
      rollback: { writer: MigrationWriter.create(spreadsheet),
        logRepository: logRepository, lock: lock,
        spreadsheetId: spreadsheet.getId() } }
  );
  assertTimelineMigrationAdmin(rollback.success, "Rollback sicuro non riuscito.");
  assertTimelineMigrationAdmin(MigrationUtils.valuesEqual(
    timeline.getDataRange().getValues()[0], TIMELINE_HEADERS),
    "Schema legacy non ripristinato.");
  return { success: true, checks: 15 };
}

function assertTimelineMigrationAdmin(condition, message) {
  if (!condition) throw new Error(message);
}
