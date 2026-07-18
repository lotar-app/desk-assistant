function legacyWorkspaceNormalizationShowFingerprint() {
  return legacyWorkspaceNormalizationLog_({
    migrationId: LegacyWorkspaceNormalization.MIGRATION_ID,
    mode: LegacyWorkspaceNormalization.MODE,
    fingerprint: LegacyWorkspaceNormalization.fingerprint()
  });
}

function legacyWorkspaceNormalizationRunPreflight() {
  return legacyWorkspaceNormalizationLog_(
    LegacyWorkspaceNormalization.preflight(
      LegacyWorkspaceNormalization.forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    )
  );
}

function legacyWorkspaceNormalizationBuildPlan() {
  return legacyWorkspaceNormalizationLog_(
    LegacyWorkspaceNormalization.manifest(
      LegacyWorkspaceNormalization.forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    )
  );
}

function legacyWorkspaceNormalizationRunPostflight(manifest) {
  return legacyWorkspaceNormalizationLog_(LegacyWorkspaceNormalization.postflight(
    LegacyWorkspaceNormalization.forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()),
    manifest
  ));
}

function legacyWorkspaceNormalizationExecute(confirmation, physicalBackup) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const dataSource = LegacyWorkspaceNormalization.forSpreadsheet(spreadsheet);
  const manifest = LegacyWorkspaceNormalization.manifest(dataSource);
  return legacyWorkspaceNormalizationLog_(
    LegacyWorkspaceNormalizationExecutor.execute(
      spreadsheet, manifest, physicalBackup, confirmation
    )
  );
}

function legacyWorkspaceNormalizationRollback(
  manifest, confirmation, physicalBackup
) {
  return legacyWorkspaceNormalizationLog_(
    LegacyWorkspaceNormalizationExecutor.rollback(
      SpreadsheetApp.getActiveSpreadsheet(), manifest,
      physicalBackup, confirmation
    )
  );
}

function legacyWorkspaceNormalizationLog_(result) {
  console.log(JSON.stringify(result, null, 2));
  return result;
}
