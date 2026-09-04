function projectActivityTimelineDeliveryMigrationPreflight(dependencies) {
  dependencies = dependencies || projectActivityTimelineDeliveryMigrationDependencies_();
  const registry = dependencies.dataSource.readSheet(
    CONFIG.SHEETS.PROJECT_ACTIVITY_TIMELINE_DELIVERY
  );
  return { success: registry.exists === false,
    migrationId: ProjectActivityTimelineDeliveryMigration.MIGRATION_ID,
    registryAbsent: registry.exists === false,
    error: registry.exists ? "TIMELINE_DELIVERY_REGISTRY_ALREADY_EXISTS" : null };
}

function projectActivityTimelineDeliveryMigrationDryRun(dependencies) {
  dependencies = dependencies || projectActivityTimelineDeliveryMigrationDependencies_();
  const manifest = ProjectActivityTimelineDeliveryMigration.createManifest(
    dependencies.dataSource
  );
  const backup = BackupEngine.create(dependencies.dataSource, manifest);
  return DryRunEngine.run(manifest, backup);
}

function projectActivityTimelineDeliveryMigrationCreatePhysicalBackup(folderId, dependencies) {
  dependencies = dependencies || projectActivityTimelineDeliveryMigrationDependencies_();
  const receipts = dependencies.backupReceiptStore.list(
    ProjectActivityTimelineDeliveryMigration.MIGRATION_ID
  );
  if (receipts.length > 1) {
    throw new Error("TIMELINE_DELIVERY_BACKUP_AMBIGUOUS");
  }
  if (receipts.length === 1) {
    throw new Error("TIMELINE_DELIVERY_BACKUP_ALREADY_REGISTERED");
  }
  const manifest = ProjectActivityTimelineDeliveryMigration.createManifest(
    dependencies.dataSource
  );
  const backup = BackupEngine.create(dependencies.dataSource, manifest);
  const physicalBackup = BackupEngine.createPhysical(backup, manifest, {
    folderId: folderId, services: dependencies.backupServices
  });
  dependencies.backupReceiptStore.save(physicalBackup);
  return physicalBackup;
}

function projectActivityTimelineDeliveryMigrationApply(
  confirmation, physicalBackup, dependencies
) {
  dependencies = dependencies || projectActivityTimelineDeliveryMigrationDependencies_();
  const manifest = ProjectActivityTimelineDeliveryMigration.createManifest(
    dependencies.dataSource
  );
  if (!confirmation || confirmation.phrase !==
      "APPLY " + ProjectActivityTimelineDeliveryMigration.MIGRATION_ID) {
    throw new Error("Conferma esplicita non valida.");
  }
  const backup = BackupEngine.create(dependencies.dataSource, manifest);
  const dryRun = DryRunEngine.run(manifest, backup);
  return MigrationExecutor.execute(manifest, backup, dryRun, physicalBackup,
    confirmation, dependencies.execution);
}

function projectActivityTimelineDeliveryMigrationPostCheck(dependencies) {
  dependencies = dependencies || projectActivityTimelineDeliveryMigrationDependencies_();
  const registry = dependencies.dataSource.readSheet(
    CONFIG.SHEETS.PROJECT_ACTIVITY_TIMELINE_DELIVERY
  );
  return { success: registry.exists && registry.rows.length === 0 &&
      MigrationUtils.valuesEqual(registry.headers,
        PROJECT_ACTIVITY_TIMELINE_DELIVERY_HEADERS),
    registryEmpty: registry.rows.length === 0,
    headers: registry.headers };
}

function projectActivityTimelineDeliveryMigrationApplyApproved() {
  return projectActivityTimelineDeliveryMigrationApplyApprovedInternal_(
    projectActivityTimelineDeliveryMigrationDependencies_()
  );
}

function projectActivityTimelineDeliveryMigrationApplyApprovedInternal_(dependencies) {
  const migrationId = ProjectActivityTimelineDeliveryMigration.MIGRATION_ID;
  const preflight = projectActivityTimelineDeliveryMigrationPreflight(dependencies);
  if (!preflight.success || !preflight.registryAbsent) {
    throw new Error("TIMELINE_DELIVERY_REGISTRY_ALREADY_EXISTS");
  }

  const receipts = dependencies.backupReceiptStore.list(migrationId);
  if (receipts.length === 0) {
    throw new Error("TIMELINE_DELIVERY_BACKUP_NOT_FOUND");
  }
  if (receipts.length !== 1) {
    throw new Error("TIMELINE_DELIVERY_BACKUP_AMBIGUOUS");
  }

  const manifest = ProjectActivityTimelineDeliveryMigration.createManifest(
    dependencies.dataSource
  );
  const backup = BackupEngine.create(dependencies.dataSource, manifest);
  const physicalBackup = receipts[0];
  projectActivityTimelineDeliveryMigrationVerifyPhysicalBackup_(
    physicalBackup, manifest, backup, dependencies
  );

  const prepared = MigrationManifest.prepare(manifest);
  const confirmation = {
    confirmed: true,
    migrationId: migrationId,
    checksum: prepared.checksum,
    signature: prepared.signature,
    backupChecksum: backup.checksum,
    phrase: "APPLY PROJECT_ACTIVITY_TIMELINE_DELIVERY_V1"
  };
  const result = projectActivityTimelineDeliveryMigrationApply(
    confirmation, physicalBackup, dependencies
  );
  const postCheck = projectActivityTimelineDeliveryMigrationPostCheck(dependencies);
  const report = {
    success: result.success === true && postCheck.success === true,
    migrationId: migrationId,
    outcome: result.outcome,
    appliedOperations: result.appliedOperations,
    registryPresent: postCheck.success === true,
    registryEmpty: postCheck.registryEmpty === true,
    headers: postCheck.headers
  };
  (dependencies.logger || console).log(JSON.stringify(report));
  return report;
}

function projectActivityTimelineDeliveryMigrationVerifyPhysicalBackup_(
  physicalBackup, manifest, backup, dependencies
) {
  if (!physicalBackup || physicalBackup.verified !== true ||
      physicalBackup.migrationId !== manifest.migrationId ||
      physicalBackup.sourceSpreadsheetId !== dependencies.spreadsheet.getId() ||
      !MigrationUtils.verifyChecksum(physicalBackup, physicalBackup.checksum)) {
    throw new Error("TIMELINE_DELIVERY_BACKUP_INVALID");
  }
  if (physicalBackup.sourceChecksum !== backup.checksum) {
    throw new Error("TIMELINE_DELIVERY_BACKUP_CHECKSUM_MISMATCH");
  }

  const services = dependencies.backupVerificationServices;
  const copyFile = services.getFileById(physicalBackup.spreadsheetCopyId);
  const xlsxFile = services.getFileById(physicalBackup.xlsxFileId);
  if (!copyFile || !xlsxFile || services.isTrashed(copyFile) ||
      services.isTrashed(xlsxFile) || Number(services.getSize(xlsxFile)) <= 0 ||
      Number(services.getSize(xlsxFile)) !== Number(physicalBackup.xlsxSize)) {
    throw new Error("TIMELINE_DELIVERY_BACKUP_FILES_INVALID");
  }
  const copiedSpreadsheet = services.openSpreadsheetById(
    physicalBackup.spreadsheetCopyId
  );
  const copiedBackup = BackupEngine.create(
    MigrationDataSource.forSpreadsheet(copiedSpreadsheet), manifest
  );
  if (copiedBackup.checksum !== physicalBackup.spreadsheetCopyChecksum ||
      copiedBackup.checksum !== physicalBackup.sourceChecksum) {
    throw new Error("TIMELINE_DELIVERY_BACKUP_COPY_MISMATCH");
  }
  return true;
}

function projectActivityTimelineDeliveryMigrationPrepareRollback(dependencies) {
  dependencies = dependencies || projectActivityTimelineDeliveryMigrationDependencies_();
  const registry = dependencies.dataSource.readSheet(
    CONFIG.SHEETS.PROJECT_ACTIVITY_TIMELINE_DELIVERY
  );
  if (!registry.exists || registry.rows.length !== 0) {
    throw new Error("TIMELINE_DELIVERY_REGISTRY_ROLLBACK_NOT_SAFE");
  }
  return RollbackEngine.buildPlan(dependencies.logRepository.read(
    ProjectActivityTimelineDeliveryMigration.MIGRATION_ID
  ), { executable: true });
}

function projectActivityTimelineDeliveryMigrationRollback(
  plan, confirmation, physicalBackup, dependencies
) {
  dependencies = dependencies || projectActivityTimelineDeliveryMigrationDependencies_();
  const registry = dependencies.dataSource.readSheet(
    CONFIG.SHEETS.PROJECT_ACTIVITY_TIMELINE_DELIVERY
  );
  if (!registry.exists || registry.rows.length !== 0) {
    throw new Error("TIMELINE_DELIVERY_REGISTRY_ROLLBACK_NOT_SAFE");
  }
  if (!confirmation || confirmation.phrase !==
      "ROLLBACK " + ProjectActivityTimelineDeliveryMigration.MIGRATION_ID) {
    throw new Error("Conferma esplicita di rollback non valida.");
  }
  return RollbackEngine.execute(plan, physicalBackup, confirmation,
    dependencies.rollback);
}

function projectActivityTimelineDeliveryMigrationDependencies_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  return { spreadsheet: spreadsheet,
    dataSource: MigrationDataSource.forSpreadsheet(spreadsheet),
    logRepository: MigrationLogRepository.create(spreadsheet),
    backupReceiptStore: projectActivityTimelineDeliveryMigrationBackupReceiptStore_(),
    backupVerificationServices:
      projectActivityTimelineDeliveryMigrationBackupVerificationServices_(),
    logger: console };
}

function projectActivityTimelineDeliveryMigrationBackupReceiptStore_() {
  const properties = PropertiesService.getDocumentProperties();
  const key = "PROJECT_ACTIVITY_MIGRATION_BACKUP::" +
    ProjectActivityTimelineDeliveryMigration.MIGRATION_ID;
  return {
    list(migrationId) {
      if (migrationId !== ProjectActivityTimelineDeliveryMigration.MIGRATION_ID) {
        throw new Error("TIMELINE_DELIVERY_BACKUP_MIGRATION_MISMATCH");
      }
      const value = properties.getProperty(key);
      if (!value) return [];
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [parsed];
    },
    save(physicalBackup) {
      if (physicalBackup.migrationId !==
          ProjectActivityTimelineDeliveryMigration.MIGRATION_ID) {
        throw new Error("TIMELINE_DELIVERY_BACKUP_MIGRATION_MISMATCH");
      }
      if (properties.getProperty(key)) {
        throw new Error("TIMELINE_DELIVERY_BACKUP_AMBIGUOUS");
      }
      properties.setProperty(key, JSON.stringify(physicalBackup));
    }
  };
}

function projectActivityTimelineDeliveryMigrationBackupVerificationServices_() {
  return {
    getFileById(id) { return DriveApp.getFileById(id); },
    openSpreadsheetById(id) { return SpreadsheetApp.openById(id); },
    getSize(file) { return file.getSize(); },
    isTrashed(file) { return file.isTrashed(); }
  };
}
