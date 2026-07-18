const LegacyWorkspaceNormalizationExecutor = {

  execute(spreadsheet, manifest, physicalBackup, confirmation, options) {
    options = options || {};
    if (manifest.mode !== "EXECUTION_APPROVED") {
      throw new Error("Manifesto normalizzazione non autorizzato.");
    }
    if (!LegacyWorkspaceNormalization.verifyManifest(manifest)) {
      throw new Error("Manifesto normalizzazione non valido.");
    }
    this.assertPhysicalBackup(manifest, physicalBackup);
    this.assertApplyConfirmation(manifest, physicalBackup, confirmation);
    const lock = options.lock || LockService.getDocumentLock();
    if (!lock.tryLock(30000)) throw new Error("Lock normalizzazione non acquisito.");
    try {
      const dataSource = LegacyWorkspaceNormalization.forSpreadsheet(spreadsheet);
      const current = LegacyWorkspaceNormalization.preflight(dataSource);
      if (!current.pass || current.projectsChecksum !==
          manifest.baselineState.projectsChecksum) {
        throw new Error("Baseline cambiata dopo la preparazione del manifesto.");
      }
      const currentBackup = BackupEngine.create(dataSource, manifest);
      if (currentBackup.checksum !== physicalBackup.sourceChecksum) {
        throw new Error("Backup fisico non corrisponde alla baseline corrente.");
      }
      const writer = LegacyWorkspaceNormalizationWriter.create(spreadsheet);
      const applied = writer.apply(manifest.operations[0], manifest);
      if (typeof SpreadsheetApp !== "undefined" && SpreadsheetApp.flush) {
        SpreadsheetApp.flush();
      }
      if (options.failAfterWrite) throw new Error("FAILURE_INJECTION_AFTER_WRITE");
      const postflight = LegacyWorkspaceNormalization.postflight(
        LegacyWorkspaceNormalization.forSpreadsheet(spreadsheet), manifest
      );
      if (!postflight.pass) {
        const error = new Error("Postflight normalizzazione fallito.");
        error.postflight = postflight;
        throw error;
      }
      return { migrationId: manifest.migrationId, success: true,
        outcome: "SUCCESS", writesApplied: 1, applied: applied,
        postflight: postflight };
    } catch (error) {
      error.migrationReport = { migrationId: manifest.migrationId,
        success: false, outcome: "FAILED_REQUIRES_ROLLBACK",
        message: error.message };
      throw error;
    } finally {
      lock.releaseLock();
    }
  },

  rollback(spreadsheet, manifest, physicalBackup, confirmation, options) {
    options = options || {};
    if (!LegacyWorkspaceNormalization.verifyManifest(manifest)) {
      throw new Error("Manifesto rollback non valido.");
    }
    this.assertPhysicalBackup(manifest, physicalBackup);
    this.assertRollbackConfirmation(manifest, physicalBackup, confirmation);
    const lock = options.lock || LockService.getDocumentLock();
    if (!lock.tryLock(30000)) throw new Error("Lock rollback non acquisito.");
    try {
      const postflight = LegacyWorkspaceNormalization.postflight(
        LegacyWorkspaceNormalization.forSpreadsheet(spreadsheet), manifest
      );
      if (!postflight.pass) throw new Error("Stato normalizzato divergente.");
      return LegacyWorkspaceNormalizationWriter.rollback(
        spreadsheet, manifest.operations[0], manifest
      );
    } finally {
      lock.releaseLock();
    }
  },

  assertPhysicalBackup(manifest, physicalBackup) {
    if (!physicalBackup || physicalBackup.verified !== true ||
        physicalBackup.migrationId !== manifest.migrationId ||
        !MigrationUtils.verifyChecksum(physicalBackup, physicalBackup.checksum)) {
      throw new Error("Backup fisico verificato non valido.");
    }
  },

  assertApplyConfirmation(manifest, backup, confirmation) {
    if (!confirmation || confirmation.confirmed !== true ||
        confirmation.phrase !== "APPLY " + manifest.migrationId ||
        confirmation.fingerprint !== manifest.fingerprint ||
        confirmation.manifestChecksum !== manifest.manifestChecksum ||
        confirmation.baselineChecksum !== manifest.baselineState.projectsChecksum ||
        confirmation.backupId !== backup.spreadsheetCopyId) {
      throw new Error("Conferma applicazione non valida.");
    }
  },

  assertRollbackConfirmation(manifest, backup, confirmation) {
    if (!confirmation || confirmation.confirmed !== true ||
        confirmation.phrase !== "ROLLBACK " + manifest.migrationId ||
        confirmation.fingerprint !== manifest.fingerprint ||
        confirmation.manifestChecksum !== manifest.manifestChecksum ||
        confirmation.backupId !== backup.spreadsheetCopyId) {
      throw new Error("Conferma rollback non valida.");
    }
  }
};
