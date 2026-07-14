const MigrationExecutor = {

  execute(manifest, backup, dryRun, physicalBackup, confirmation, dependencies) {
    MigrationSafetyGuard.assertExecution(
      manifest,
      backup,
      dryRun,
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
      throw new Error("Impossibile acquisire il lock della migrazione.");
    }

    try {
      const currentBackup = BackupEngine.create(
        dependencies.dataSource,
        manifest
      );

      if (currentBackup.checksum !== backup.checksum) {
        throw new Error(
          "Il database è cambiato dopo il dry run. Migrazione interrotta."
        );
      }

      const existingLog = dependencies.logRepository.read(
        manifest.migrationId
      );

      if (!existingLog.valid) {
        throw new Error(existingLog.errors.join("; "));
      }

      if (existingLog.entries.length > 0) {
        throw new Error(
          "Esiste già un log per la migrazione " + manifest.migrationId + "."
        );
      }

      let sequence = 1;
      const applied = [];

      manifest.operations.forEach(operation => {
        dependencies.logRepository.append({
          migrationId: manifest.migrationId,
          sequence: sequence++,
          operationId: operation.operationId,
          action: operation.action,
          sheet: operation.sheet,
          status: "PLANNED",
          before: null,
          after: operation.after || null,
          message: operation.reason || ""
        });

        let result;

        try {
          result = dependencies.writer.apply(operation);
        } catch (error) {
          dependencies.logRepository.append({
            migrationId: manifest.migrationId,
            sequence: sequence++,
            operationId: operation.operationId,
            action: operation.action,
            sheet: operation.sheet,
            status: "FAILED",
            before: null,
            after: null,
            message: error.message
          });
          throw error;
        }

        try {
          dependencies.logRepository.append({
            migrationId: manifest.migrationId,
            sequence: sequence++,
            operationId: operation.operationId,
            action: operation.action,
            sheet: operation.sheet,
            status: "APPLIED",
            before: result.before,
            after: result.after,
            message: "Operazione applicata."
          });
        } catch (logError) {
          const compensation = RollbackEngine.operationFromEntry({
            operationId: operation.operationId,
            action: operation.action,
            sheet: operation.sheet,
            before: result.before,
            after: result.after
          });
          dependencies.writer.applyRollback(compensation);
          throw new Error(
            "Scrittura MigrationLog fallita; operazione compensata: " +
              logError.message
          );
        }

        applied.push(operation.operationId);
      });

      dependencies.logRepository.append({
        migrationId: manifest.migrationId,
        sequence: sequence,
        operationId: "MIGRATION-COMPLETE",
        action: "META",
        sheet: CONFIG.SHEETS.MIGRATION_LOG,
        status: "COMPLETED",
        before: null,
        after: { appliedOperations: applied.length },
        message: "Migrazione completata."
      });

      return {
        success: true,
        migrationId: manifest.migrationId,
        appliedOperations: applied,
        physicalBackupId: physicalBackup.spreadsheetCopyId
      };
    } finally {
      lock.releaseLock();
    }
  },

  defaultDependencies() {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    return {
      dataSource: MigrationDataSource.forSpreadsheet(spreadsheet),
      writer: MigrationWriter.create(spreadsheet),
      logRepository: MigrationLogRepository.create(spreadsheet),
      lock: LockService.getDocumentLock(),
      spreadsheetId: spreadsheet.getId()
    };
  }

};
