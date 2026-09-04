function testProjectActivityTimelineDeliveryMigration() {
  const spreadsheet = createMigrationTestSpreadsheet({
    Timeline: [TIMELINE_CANONICAL_HEADERS]
  });
  const dataSource = MigrationDataSource.forSpreadsheet(spreadsheet);
  const dependencies = { spreadsheet: spreadsheet, dataSource: dataSource };
  const preflight = projectActivityTimelineDeliveryMigrationPreflight(dependencies);
  assertDeliveryMigration(preflight.success && preflight.registryAbsent,
    "Preflight registry non valido.");
  const dryRun = projectActivityTimelineDeliveryMigrationDryRun(dependencies);
  assertDeliveryMigration(dryRun.success && dryRun.operations.length === 1 &&
    dryRun.operations[0].action === "CREATE_SHEET", "Dry-run non valido.");

  const manifest = ProjectActivityTimelineDeliveryMigration.createManifest(dataSource);
  const backup = BackupEngine.create(dataSource, manifest);
  const copiedSpreadsheet = createMigrationTestSpreadsheet({
    Timeline: [TIMELINE_CANONICAL_HEADERS]
  });
  const physicalBackup = projectActivityTimelineDeliveryMigrationCreatePhysicalBackup(null, {
    spreadsheet: spreadsheet, dataSource: dataSource,
    backupServices: migrationBackupTestServices(spreadsheet, copiedSpreadsheet)
  });
  const prepared = MigrationManifest.prepare(manifest);
  const confirmation = { confirmed: true, migrationId: manifest.migrationId,
    checksum: prepared.checksum, signature: prepared.signature,
    backupChecksum: backup.checksum,
    phrase: "APPLY PROJECT_ACTIVITY_TIMELINE_DELIVERY_V1" };
  let badConfirmation = null;
  try { projectActivityTimelineDeliveryMigrationApply(
    Object.assign({}, confirmation, { phrase: "APPLY" }), physicalBackup,
    dependencies); } catch (error) { badConfirmation = error; }
  assertDeliveryMigration(!!badConfirmation, "Conferma generica accettata.");

  const logRepository = MigrationLogRepository.create(spreadsheet);
  const execution = { dataSource: dataSource,
    writer: MigrationWriter.create(spreadsheet), logRepository: logRepository,
    lock: migrationTestLock(), spreadsheetId: spreadsheet.getId() };
  const result = projectActivityTimelineDeliveryMigrationApply(
    confirmation, physicalBackup, { spreadsheet: spreadsheet,
      dataSource: dataSource, execution: execution });
  assertDeliveryMigration(result.success, "Apply registry non riuscito.");
  const post = projectActivityTimelineDeliveryMigrationPostCheck({
    spreadsheet: spreadsheet, dataSource: dataSource
  });
  assertDeliveryMigration(post.success && post.registryEmpty,
    "Post-check registry non valido.");

  const rollbackDependencies = { spreadsheet: spreadsheet, dataSource: dataSource,
    logRepository: logRepository };
  const plan = projectActivityTimelineDeliveryMigrationPrepareRollback(
    rollbackDependencies
  );
  assertDeliveryMigration(plan.executable && plan.operations.length === 1,
    "Rollback sicuro non preparato.");
  spreadsheet.getSheetByName(CONFIG.SHEETS.PROJECT_ACTIVITY_TIMELINE_DELIVERY)
    .appendRow(["EVT-FIXTURE", "PRJ-LOTAR", "fingerprint", 2, new Date(), "DELIVERED"]);
  let unsafe = null;
  try { projectActivityTimelineDeliveryMigrationPrepareRollback(rollbackDependencies); }
  catch (error) { unsafe = error; }
  assertDeliveryMigration(unsafe && unsafe.message ===
    "TIMELINE_DELIVERY_REGISTRY_ROLLBACK_NOT_SAFE",
  "Rollback registry usato non bloccato.");
  return { success: true, migrationId: manifest.migrationId };
}

function assertDeliveryMigration(condition, message) {
  if (!condition) throw new Error(message);
}
