const RollbackEngine = {

  buildPlan(migrationLog, options) {
    options = options || {};
    if (!migrationLog || !Array.isArray(migrationLog.entries)) {
      throw new Error("Migration log non valido per il rollback.");
    }

    const rolledBack = {};

    migrationLog.entries
      .filter(entry => entry.status === "ROLLBACK_APPLIED")
      .forEach(entry => {
        rolledBack[String(entry.operationId).replace(/^ROLLBACK-/, "")] = true;
      });

    const applied = migrationLog.entries
      .filter(entry => (
        entry.status === "APPLIED" && !rolledBack[entry.operationId]
      ))
      .slice()
      .reverse();

    const operations = applied.map(entry => this.operationFromEntry(entry));

    const plan = {
      migrationId: migrationLog.migrationId,
      createdAt: options.createdAt || new Date().toISOString(),
      readOnly: true,
      executable: options.executable === true,
      operations: operations
    };

    plan.checksum = MigrationUtils.checksum(plan);
    return plan;
  },

  operationFromEntry(entry) {
    return {
      rollbackOperationId: "ROLLBACK-" + entry.operationId,
      sourceOperationId: entry.operationId,
      sheet: entry.sheet,
      action: this.inverseAction(entry.action),
      restore: MigrationUtils.clone(entry.before),
      expectedCurrent: MigrationUtils.clone(entry.after)
    };
  },

  execute(plan, physicalBackup, confirmation, dependencies) {
    if (!MigrationUtils.verifyChecksum(plan, plan.checksum)) {
      throw new Error("Checksum del piano di rollback non valido.");
    }

    MigrationSafetyGuard.assertRollback(
      plan,
      physicalBackup,
      confirmation
    );

    dependencies = dependencies || this.defaultDependencies();

    if (
      dependencies.spreadsheetId &&
      physicalBackup.sourceSpreadsheetId !== dependencies.spreadsheetId
    ) {
      throw new Error("Il backup appartiene a uno Spreadsheet differente.");
    }

    const lock = dependencies.lock;

    if (!lock.tryLock(30000)) {
      throw new Error("Impossibile acquisire il lock del rollback.");
    }

    try {
      const persistedLog = dependencies.logRepository.read(plan.migrationId);

      if (!persistedLog.valid) {
        throw new Error(persistedLog.errors.join("; "));
      }

      const expectedPlan = this.buildPlan(persistedLog, {
        executable: true,
        createdAt: plan.createdAt
      });

      if (expectedPlan.checksum !== plan.checksum) {
        throw new Error("Il MigrationLog non corrisponde al piano di rollback.");
      }

      let sequence = dependencies.logRepository.nextSequence(plan.migrationId);
      const applied = [];

      plan.operations.forEach(operation => {
        const result = dependencies.writer.applyRollback(operation);
        dependencies.logRepository.append({
          migrationId: plan.migrationId,
          sequence: sequence++,
          operationId: operation.rollbackOperationId,
          action: operation.action,
          sheet: operation.sheet,
          status: "ROLLBACK_APPLIED",
          before: result.before,
          after: result.after,
          message: "Rollback applicato."
        });
        applied.push(operation.rollbackOperationId);
      });

      return {
        success: true,
        migrationId: plan.migrationId,
        rollbackOperations: applied
      };
    } finally {
      lock.releaseLock();
    }
  },

  defaultDependencies() {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    return {
      writer: MigrationWriter.create(spreadsheet),
      logRepository: MigrationLogRepository.create(spreadsheet),
      lock: LockService.getDocumentLock(),
      spreadsheetId: spreadsheet.getId()
    };
  },

  inverseAction(action) {
    const inverse = {
      CREATE: "DELETE",
      DELETE: "RESTORE",
      UPDATE: "RESTORE",
      MOVE: "RESTORE",
      COMPLETE: "RESTORE"
    }[action];

    if (!inverse) {
      throw new Error("Azione non invertibile: " + action);
    }

    return inverse;
  }

};
