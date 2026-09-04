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
  const receiptStore = migrationBackupReceiptTestStore_();
  const verificationServices = migrationBackupVerificationTestServices_(
    copiedSpreadsheet
  );
  const physicalBackup = projectActivityTimelineDeliveryMigrationCreatePhysicalBackup(null, {
    spreadsheet: spreadsheet, dataSource: dataSource,
    backupServices: migrationBackupTestServices(spreadsheet, copiedSpreadsheet),
    backupReceiptStore: receiptStore
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
  testProjectActivityTimelineDeliveryApprovedApply_();
  return { success: true, migrationId: manifest.migrationId };
}

function testProjectActivityTimelineDeliveryApprovedApply_() {
  const fixture = projectActivityTimelineDeliveryApprovedFixture_();
  const report = projectActivityTimelineDeliveryMigrationApplyApprovedInternal_(
    fixture.dependencies
  );
  assertDeliveryMigration(report.success && report.registryPresent &&
    report.registryEmpty && report.appliedOperations.length === 1,
  "Happy path entrypoint approvato non valido.");
  assertDeliveryMigration(report.appliedOperations[0] ===
    "CREATE-PROJECT-ACTIVITY-TIMELINE-DELIVERY",
  "Apply approvato ha eseguito operazioni inattese.");
  assertDeliveryMigration(fixture.spreadsheet.getSheetByName("Timeline")
    .getLastRow() === 1, "Timeline modificata dall'apply approvato.");

  assertApprovedApplyFailure_([], "TIMELINE_DELIVERY_BACKUP_NOT_FOUND");
  assertApprovedApplyFailure_([fixture.physicalBackup, fixture.physicalBackup],
    "TIMELINE_DELIVERY_BACKUP_AMBIGUOUS");
  assertApprovedApplyMutationFailure_(function(physicalBackup) {
    physicalBackup.sourceChecksum = "wrong";
  }, "TIMELINE_DELIVERY_BACKUP_INVALID");
  assertApprovedApplyMutationFailure_(function(physicalBackup) {
    physicalBackup.migrationId = "WRONG_MIGRATION";
  }, "TIMELINE_DELIVERY_BACKUP_INVALID");
  assertApprovedApplyMutationFailure_(function(physicalBackup) {
    physicalBackup.spreadsheetCopyChecksum = "wrong";
    delete physicalBackup.checksum;
    physicalBackup.checksum = MigrationUtils.checksum(physicalBackup);
  }, "TIMELINE_DELIVERY_BACKUP_COPY_MISMATCH");

  const registryFixture = projectActivityTimelineDeliveryApprovedFixture_();
  registryFixture.spreadsheet.insertSheet(
    CONFIG.SHEETS.PROJECT_ACTIVITY_TIMELINE_DELIVERY
  ).appendRow(PROJECT_ACTIVITY_TIMELINE_DELIVERY_HEADERS);
  let registryError = null;
  try { projectActivityTimelineDeliveryMigrationApplyApprovedInternal_(
    registryFixture.dependencies); } catch (error) { registryError = error; }
  assertDeliveryMigration(registryError && registryError.message ===
    "TIMELINE_DELIVERY_REGISTRY_ALREADY_EXISTS",
  "Registry esistente non bloccato.");

  let safetyBypass = null;
  try { projectActivityTimelineDeliveryMigrationApply(
    { phrase: "APPLY PROJECT_ACTIVITY_TIMELINE_DELIVERY_V1" },
    fixture.physicalBackup, fixture.dependencies); }
  catch (error) { safetyBypass = error; }
  assertDeliveryMigration(!!safetyBypass,
    "MigrationSafetyGuard aggirabile con la sola phrase.");

  const source = projectActivityTimelineDeliveryMigrationApplyApproved.toString();
  assertDeliveryMigration(source.indexOf("MigrationApplyApprovedInternal_") !== -1,
    "Entrypoint senza argomenti non delega all'adapter sicuro.");
  assertDeliveryMigration(source.indexOf("console.log") === -1,
    "Il caricamento del codice produce side effect.");
  const internalSource =
    projectActivityTimelineDeliveryMigrationApplyApprovedInternal_.toString();
  assertDeliveryMigration(internalSource.indexOf(
    "APPLY PROJECT_ACTIVITY_TIMELINE_DELIVERY_V1") !== -1,
  "Phrase esatta assente dall'adapter.");
  assertDeliveryMigration(internalSource.indexOf("dependencies.logger") !== -1,
    "Log amministrativo assente.");
  assertDeliveryMigration(fixture.logs.length === 1 &&
    fixture.logs[0].indexOf("PROJECT_ACTIVITY_TIMELINE_DELIVERY_V1") !== -1 &&
    fixture.logs[0].indexOf("checksum") === -1 &&
    fixture.logs[0].indexOf("secret") === -1 &&
    fixture.logs[0].indexOf("token") === -1,
  "Log amministrativo non minimale o contiene dati vietati.");
  testProjectActivityTimelineDeliverySafetyConfirmation_();
}

function testProjectActivityTimelineDeliverySafetyConfirmation_() {
  ["checksum", "signature", "phrase", "migrationId"].forEach(function(field) {
    const fixture = projectActivityTimelineDeliveryApprovedFixture_();
    const manifest = ProjectActivityTimelineDeliveryMigration.createManifest(
      fixture.dependencies.dataSource
    );
    const backup = BackupEngine.create(fixture.dependencies.dataSource, manifest);
    const prepared = MigrationManifest.prepare(manifest);
    const confirmation = { confirmed: true, migrationId: manifest.migrationId,
      checksum: prepared.checksum, signature: prepared.signature,
      backupChecksum: backup.checksum,
      phrase: "APPLY PROJECT_ACTIVITY_TIMELINE_DELIVERY_V1" };
    confirmation[field] = "WRONG";
    let failure = null;
    try { projectActivityTimelineDeliveryMigrationApply(
      confirmation, fixture.physicalBackup, fixture.dependencies); }
    catch (error) { failure = error; }
    assertDeliveryMigration(!!failure,
      "Safety guard ha accettato confirmation errata: " + field);
    assertDeliveryMigration(fixture.spreadsheet.getSheetByName(
      CONFIG.SHEETS.PROJECT_ACTIVITY_TIMELINE_DELIVERY) === null,
    "Confirmation errata ha prodotto side effect: " + field);
  });
}

function assertApprovedApplyFailure_(receipts, expectedMessage) {
  const fixture = projectActivityTimelineDeliveryApprovedFixture_();
  fixture.dependencies.backupReceiptStore = {
    list() { return receipts; }, save() {}
  };
  let failure = null;
  try { projectActivityTimelineDeliveryMigrationApplyApprovedInternal_(
    fixture.dependencies); } catch (error) { failure = error; }
  assertDeliveryMigration(failure && failure.message === expectedMessage,
    "Errore adapter inatteso: " + (failure && failure.message));
  assertDeliveryMigration(fixture.spreadsheet.getSheetByName(
    CONFIG.SHEETS.PROJECT_ACTIVITY_TIMELINE_DELIVERY) === null,
  "Apply fallito ha creato il registry.");
}

function assertApprovedApplyMutationFailure_(mutate, expectedMessage) {
  const fixture = projectActivityTimelineDeliveryApprovedFixture_();
  mutate(fixture.physicalBackup);
  fixture.dependencies.backupReceiptStore = {
    list() { return [fixture.physicalBackup]; }, save() {}
  };
  let failure = null;
  try { projectActivityTimelineDeliveryMigrationApplyApprovedInternal_(
    fixture.dependencies); } catch (error) { failure = error; }
  assertDeliveryMigration(failure && failure.message === expectedMessage,
    "Validazione backup inattesa: " + (failure && failure.message));
}

function projectActivityTimelineDeliveryApprovedFixture_() {
  const spreadsheet = createMigrationTestSpreadsheet({
    Timeline: [TIMELINE_CANONICAL_HEADERS]
  });
  const copiedSpreadsheet = createMigrationTestSpreadsheet({
    Timeline: [TIMELINE_CANONICAL_HEADERS]
  });
  const dataSource = MigrationDataSource.forSpreadsheet(spreadsheet);
  const manifest = ProjectActivityTimelineDeliveryMigration.createManifest(dataSource);
  const backup = BackupEngine.create(dataSource, manifest);
  const physicalBackup = {
    migrationId: manifest.migrationId,
    createdAt: new Date().toISOString(),
    sourceSpreadsheetId: spreadsheet.getId(),
    sourceChecksum: backup.checksum,
    spreadsheetCopyId: copiedSpreadsheet.getId(),
    spreadsheetCopyChecksum: backup.checksum,
    xlsxFileId: "TEST-XLSX",
    xlsxSize: 10,
    copyVerified: true,
    xlsxVerified: true,
    verified: true
  };
  physicalBackup.checksum = MigrationUtils.checksum(physicalBackup);
  const receiptStore = migrationBackupReceiptTestStore_([physicalBackup]);
  const logRepository = MigrationLogRepository.create(spreadsheet);
  const logs = [];
  const dependencies = {
    spreadsheet: spreadsheet,
    dataSource: dataSource,
    logRepository: logRepository,
    backupReceiptStore: receiptStore,
    backupVerificationServices:
      migrationBackupVerificationTestServices_(copiedSpreadsheet),
    logger: { log(value) { logs.push(String(value)); } },
    execution: {
      dataSource: dataSource,
      writer: MigrationWriter.create(spreadsheet),
      logRepository: logRepository,
      lock: migrationTestLock(),
      spreadsheetId: spreadsheet.getId()
    }
  };
  return { spreadsheet: spreadsheet, physicalBackup: physicalBackup,
    dependencies: dependencies, logs: logs };
}

function migrationBackupReceiptTestStore_(initial) {
  const receipts = (initial || []).slice();
  return {
    list() { return receipts.slice(); },
    save(receipt) {
      if (receipts.length) throw new Error("TIMELINE_DELIVERY_BACKUP_AMBIGUOUS");
      receipts.push(receipt);
    }
  };
}

function migrationBackupVerificationTestServices_(copiedSpreadsheet) {
  return {
    getFileById(id) { return { id: id, size: 10, trashed: false }; },
    openSpreadsheetById() { return copiedSpreadsheet; },
    getSize(file) { return file.size; },
    isTrashed(file) { return file.trashed; }
  };
}

function assertDeliveryMigration(condition, message) {
  if (!condition) throw new Error(message);
}
