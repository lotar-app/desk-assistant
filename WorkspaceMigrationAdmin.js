/**
 * Entry point amministrativi della migrazione Workspace.
 * Le funzioni read-only non restituiscono valori Settings o payload di righe.
 */
function workspaceMigrationShowFingerprint() {
  return {
    migrationId: WorkspaceMigration.MIGRATION_ID,
    mode: WorkspaceMigration.MODE,
    fingerprintAlgorithm: "SHA-256 canonical JSON",
    fingerprint: WorkspaceMigration.fingerprint(),
    operationCounts: {
      structural: WorkspaceMigration.structuralOperations().length,
      workspaces: WorkspaceMigration.APPROVED_WORKSPACES.length,
      aliases: WorkspaceMigration.APPROVED_ALIASES.length,
      projects: Object.keys(WorkspaceMigration.APPROVED_PROJECT_MAPPING).length
    }
  };
}

function workspaceMigrationRunPreflight() {
  const result = WorkspaceMigration.preflight(
    MigrationDataSource.forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
  );

  migrationAdminLogResult_("workspaceMigrationRunPreflight", result);
  return result;
}

function migrationAdminLogResult_(operation, result) {
  console.log(JSON.stringify({
    operation: operation,
    result: result
  }, null, 2));

  return result;
}

function workspaceMigrationBuildPlan() {
  const dataSource = MigrationDataSource.forSpreadsheet(
    SpreadsheetApp.getActiveSpreadsheet()
  );
  const manifest = WorkspaceMigration.manifest(dataSource);
  const prepared = MigrationManifest.prepare(manifest);
  return {
    migrationId: manifest.migrationId,
    mode: manifest.mode,
    frozenFingerprint: WorkspaceMigration.fingerprint(),
    manifestChecksum: prepared.checksum,
    manifestSignature: prepared.signature,
    operationCount: manifest.operations.length,
    operations: manifest.operations.map(operation => ({
      operationId: operation.operationId,
      action: operation.action,
      sheet: operation.sheet
    }))
  };
}

function workspaceMigrationRunDryRun() {
  const startedAt = new Date();
  const dataSource = MigrationDataSource.forSpreadsheet(
    SpreadsheetApp.getActiveSpreadsheet()
  );
  const manifest = WorkspaceMigration.manifest(dataSource);
  const snapshot = BackupEngine.create(dataSource, manifest);
  const dryRun = DryRunEngine.run(manifest, snapshot);
  const finishedAt = new Date();
  return {
    migrationId: manifest.migrationId,
    mode: manifest.mode,
    frozenFingerprint: WorkspaceMigration.fingerprint(),
    manifestChecksum: dryRun.manifestChecksum || "",
    baselineChecksum: dryRun.backupChecksum || snapshot.checksum,
    success: dryRun.success === true,
    baseline: {
      valid: dryRun.baseline && dryRun.baseline.valid === true,
      errors: dryRun.baseline ? dryRun.baseline.errors : []
    },
    operations: dryRun.operations.map(operation => ({
      operationId: operation.operationId,
      action: operation.action,
      sheet: operation.sheet,
      valid: operation.valid,
      reason: operation.reason
    })),
    report: WorkspaceMigration.report(dryRun, startedAt, finishedAt)
  };
}

function workspaceMigrationRunSafeRuntimeTests() {
  return {
    migrationId: WorkspaceMigration.MIGRATION_ID,
    mode: WorkspaceMigration.MODE,
    fingerprint: WorkspaceMigration.fingerprint(),
    hardening: testWorkspaceMigrationHardening(),
    genericFramework: testMigrationFramework()
  };
}

function workspaceMigrationExecute(confirmation, physicalBackup) {
  if (WorkspaceMigration.MODE !== "EXECUTION_APPROVED") {
    throw new Error(
      "Esecuzione rifiutata: manifesto Workspace in stato " +
        WorkspaceMigration.MODE + "."
    );
  }
  const dataSource = MigrationDataSource.forSpreadsheet(
    SpreadsheetApp.getActiveSpreadsheet()
  );
  const manifest = WorkspaceMigration.manifest(dataSource);
  if (!confirmation || confirmation.phrase !== "APPLY " + manifest.migrationId) {
    throw new Error("Esecuzione rifiutata: conferma forte non valida.");
  }
  const snapshot = BackupEngine.create(dataSource, manifest);
  const dryRun = DryRunEngine.run(manifest, snapshot);
  return MigrationExecutor.execute(
    manifest, snapshot, dryRun, physicalBackup, confirmation
  );
}

function workspaceMigrationPrepareRollback() {
  if (WorkspaceMigration.MODE !== "EXECUTION_APPROVED") {
    throw new Error(
      "Preparazione rollback rifiutata: manifesto Workspace in stato " +
        WorkspaceMigration.MODE + "."
    );
  }
  const repository = MigrationLogRepository.create(
    SpreadsheetApp.getActiveSpreadsheet()
  );
  const log = repository.read(WorkspaceMigration.MIGRATION_ID);
  return RollbackEngine.buildPlan(log, { executable: true });
}

function workspaceMigrationRollback(plan, confirmation, physicalBackup) {
  if (WorkspaceMigration.MODE !== "EXECUTION_APPROVED") {
    throw new Error(
      "Rollback rifiutato: manifesto Workspace in stato " +
        WorkspaceMigration.MODE + "."
    );
  }
  if (!plan || plan.migrationId !== WorkspaceMigration.MIGRATION_ID ||
      plan.executable !== true) {
    throw new Error("Rollback rifiutato: piano eseguibile non valido.");
  }
  if (!confirmation || confirmation.phrase !==
      "ROLLBACK " + WorkspaceMigration.MIGRATION_ID ||
      confirmation.checksum !== plan.checksum) {
    throw new Error("Rollback rifiutato: conferma forte non valida.");
  }
  return RollbackEngine.execute(plan, physicalBackup, confirmation);
}
