function taskIdRepairExecuteApprovedV1Internal_() {
  const startedAt = new Date();
  const authorization = {
    approved: true,
    migrationId: "TASK_ID_REPAIR_V1",
    version: "1.0.0",
    fingerprint: "e213f1745979fd258aaf6333df5c33ee2b4f87f942151976993107bb7186f4bc",
    tasksChecksum: "3d420bb30fc2c7e95021ba995172ac1d1af6a5a8d097d01ae00cd67bc3740d44"
  };
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const lock = LockService.getDocumentLock();
  const applied = [];
  let physicalBackup = null;
  let otherSheetsBefore = null;
  let snapshot = null;
  let writesStarted = false;
  let rollbackStatus = "NOT_REQUIRED";

  if (!lock.tryLock(30000)) {
    return taskIdRepairExecutionReport({
      startedAt: startedAt,
      status: "EXECUTION_ABORTED",
      authorization: authorization,
      errors: ["Impossibile acquisire il lock documentale."],
      applied: applied,
      rollbackStatus: rollbackStatus
    });
  }

  try {
    const manifest = TaskIdRepairMigration.frozenManifest();
    if (manifest.fingerprint !== authorization.fingerprint) {
      throw new Error("Fingerprint manifesto divergente.");
    }
    TaskIdRepairMigration.assertExecutionAuthorization(authorization);

    const dataSource = MigrationDataSource.forSpreadsheet(spreadsheet);
    const preflight = TaskIdRepairMigration.preflight(manifest, dataSource);
    if (!preflight.pass) {
      throw new Error("Preflight fallito: " + preflight.errors.join("; "));
    }
    if (preflight.diagnosis.taskCount !== 40 ||
        preflight.diagnosis.tasksChecksum !== authorization.tasksChecksum ||
        preflight.diagnosis.duplicates.length !== 3) {
      throw new Error("Baseline Tasks divergente dopo il preflight.");
    }

    otherSheetsBefore = taskIdRepairOtherSheetChecksums(spreadsheet);
    snapshot = BackupEngine.create(dataSource, manifest);
    if (snapshot.checksum === "") {
      throw new Error("Checksum snapshot logico mancante.");
    }
    physicalBackup = BackupEngine.createPhysical(snapshot, manifest);
    if (!physicalBackup || physicalBackup.verified !== true ||
        physicalBackup.sourceChecksum !== snapshot.checksum) {
      throw new Error("Backup fisico non verificato.");
    }

    const dryRun = DryRunEngine.run(manifest, snapshot);
    if (!dryRun.success || dryRun.operations.length !== 3 ||
        !dryRun.operations.every(operation => operation.valid === true)) {
      throw new Error("Dry run non valido o diverso da tre operazioni.");
    }

    const writer = TaskIdRepairMigration.createWriter(
      spreadsheet, authorization
    );
    writesStarted = true;
    manifest.operations.forEach(operation => {
      writer.apply(operation);
      applied.push(operation.operationId);
    });

    const postflight = TaskIdRepairMigration.postflight(
      manifest, dataSource, snapshot.sheets.Tasks
    );
    const otherSheetsAfter = taskIdRepairOtherSheetChecksums(spreadsheet);
    if (!postflight.pass || postflight.taskCount !== 40 ||
        applied.length !== 3 ||
        !MigrationUtils.valuesEqual(otherSheetsBefore, otherSheetsAfter)) {
      throw new Error("Postflight fallito: " +
        postflight.errors.join("; ") +
        (!MigrationUtils.valuesEqual(otherSheetsBefore, otherSheetsAfter)
          ? "; checksum altri fogli divergenti" : ""));
    }

    return taskIdRepairExecutionReport({
      startedAt: startedAt,
      status: "EXECUTION_COMPLETED",
      authorization: authorization,
      physicalBackup: physicalBackup,
      initialChecksum: preflight.diagnosis.tasksChecksum,
      finalChecksum: postflight.checksum,
      preflight: preflight,
      postflight: postflight,
      applied: applied,
      rollbackStatus: rollbackStatus,
      errors: []
    });
  } catch (error) {
    const errors = [error.message];
    if (writesStarted && applied.length > 0 && snapshot) {
      try {
        const dataSource = MigrationDataSource.forSpreadsheet(spreadsheet);
        const plan = TaskIdRepairMigration.rollbackPlan(
          TaskIdRepairMigration.frozenManifest(), dataSource, applied,
          snapshot.sheets.Tasks
        );
        if (plan.errors.length > 0 || plan.operations.length !== applied.length) {
          throw new Error("Piano rollback divergente: " + plan.errors.join("; "));
        }
        const writer = TaskIdRepairMigration.createWriter(
          spreadsheet, authorization
        );
        plan.operations.forEach(operation => writer.applyRollback(operation));
        const restored = TaskIdRepairMigration.diagnose(dataSource);
        const otherSheetsAfterRollback = taskIdRepairOtherSheetChecksums(
          spreadsheet
        );
        if (restored.tasksChecksum !== authorization.tasksChecksum ||
            !MigrationUtils.valuesEqual(
              otherSheetsBefore, otherSheetsAfterRollback
            )) {
          throw new Error("Verifica successiva al rollback fallita.");
        }
        rollbackStatus = "ROLLBACK_COMPLETED";
      } catch (rollbackError) {
        rollbackStatus = "ROLLBACK_BLOCKED";
        errors.push(rollbackError.message);
      }
    }
    return taskIdRepairExecutionReport({
      startedAt: startedAt,
      status: writesStarted ? "EXECUTION_FAILED" : "EXECUTION_ABORTED",
      authorization: authorization,
      physicalBackup: physicalBackup,
      applied: applied,
      rollbackStatus: rollbackStatus,
      errors: errors
    });
  } finally {
    lock.releaseLock();
  }
}

function taskIdRepairOtherSheetChecksums(spreadsheet) {
  const result = {};
  spreadsheet.getSheets().forEach(sheet => {
    if (sheet.getName() !== CONFIG.SHEETS.TASKS) {
      result[sheet.getName()] = MigrationUtils.checksum(
        sheet.getDataRange().getValues().map(row => (
          row.map(value => MigrationUtils.normalizeValue(value))
        ))
      );
    }
  });
  return result;
}

function taskIdRepairExecutionReport(data) {
  const finishedAt = new Date();
  const report = {
    migrationId: "TASK_ID_REPAIR_V1",
    version: "1.0.0",
    status: data.status,
    startedAt: data.startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - data.startedAt.getTime(),
    fingerprint: data.authorization.fingerprint,
    fingerprintVerified: data.authorization.fingerprint ===
      TaskIdRepairMigration.frozenManifest().fingerprint,
    expectedInitialChecksum: data.authorization.tasksChecksum,
    initialChecksum: data.initialChecksum || "",
    finalChecksum: data.finalChecksum || "",
    backup: data.physicalBackup ? {
      verified: data.physicalBackup.verified === true,
      copyVerified: data.physicalBackup.copyVerified === true,
      xlsxVerified: data.physicalBackup.xlsxVerified === true
    } : { verified: false, copyVerified: false, xlsxVerified: false },
    appliedOperations: data.applied || [],
    preflightPassed: !!data.preflight && data.preflight.pass === true,
    postflightPassed: !!data.postflight && data.postflight.pass === true,
    rollbackStatus: data.rollbackStatus,
    onlyTasksIdModified: data.status === "EXECUTION_COMPLETED",
    warnings: [],
    errors: data.errors || []
  };
  console.log(JSON.stringify(report));
  return report;
}
