const MigrationSafetyGuard = {

  assertExecution(manifest, backup, dryRun, physicalBackup, confirmation) {
    if (manifest.mode !== "EXECUTION_APPROVED") {
      throw new Error("Il manifesto non è autorizzato all'esecuzione.");
    }

    if (!dryRun || !dryRun.success || dryRun.dryRun !== true) {
      throw new Error("Dry run valido mancante.");
    }

    if (!physicalBackup || physicalBackup.verified !== true) {
      throw new Error("Backup fisico verificato mancante.");
    }

    if (
      physicalBackup.migrationId !== manifest.migrationId ||
      !MigrationUtils.verifyChecksum(
        physicalBackup,
        physicalBackup.checksum
      )
    ) {
      throw new Error("Certificato del backup fisico non valido.");
    }

    if (
      dryRun.backupChecksum !== backup.checksum ||
      physicalBackup.sourceChecksum !== backup.checksum
    ) {
      throw new Error("Checksum backup non coerenti.");
    }

    const prepared = MigrationManifest.prepare(manifest);

    if (dryRun.manifestChecksum !== prepared.checksum) {
      throw new Error("Checksum manifesto non coerente con il dry run.");
    }

    this.assertConfirmation(
      confirmation,
      manifest.migrationId,
      prepared.checksum,
      backup.checksum,
      "APPLY " + manifest.migrationId
    );

    return true;
  },

  assertRollback(plan, physicalBackup, confirmation) {
    if (!plan || plan.executable !== true || !plan.checksum) {
      throw new Error("Piano di rollback non autorizzato.");
    }

    if (!physicalBackup || physicalBackup.verified !== true) {
      throw new Error("Backup fisico verificato mancante per il rollback.");
    }

    if (
      physicalBackup.migrationId !== plan.migrationId ||
      !MigrationUtils.verifyChecksum(
        physicalBackup,
        physicalBackup.checksum
      )
    ) {
      throw new Error("Certificato del backup fisico non valido per il rollback.");
    }

    this.assertConfirmation(
      confirmation,
      plan.migrationId,
      plan.checksum,
      physicalBackup.sourceChecksum,
      "ROLLBACK " + plan.migrationId
    );

    return true;
  },

  assertConfirmation(confirmation, migrationId, checksum, backupChecksum, phrase) {
    if (
      !confirmation ||
      confirmation.confirmed !== true ||
      confirmation.migrationId !== migrationId ||
      confirmation.checksum !== checksum ||
      confirmation.backupChecksum !== backupChecksum ||
      confirmation.phrase !== phrase
    ) {
      throw new Error("Conferma esplicita non valida.");
    }
  }

};
