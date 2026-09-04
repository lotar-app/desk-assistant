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
  const manifest = ProjectActivityTimelineDeliveryMigration.createManifest(
    dependencies.dataSource
  );
  const backup = BackupEngine.create(dependencies.dataSource, manifest);
  return BackupEngine.createPhysical(backup, manifest, {
    folderId: folderId, services: dependencies.backupServices
  });
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
    logRepository: MigrationLogRepository.create(spreadsheet) };
}
