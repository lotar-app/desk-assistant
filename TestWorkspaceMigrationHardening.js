function testWorkspaceMigrationHardening() {
  const frozenPayload = WorkspaceMigration.fingerprintPayload();
  const frozenFingerprint = WorkspaceMigration.fingerprint();
  [
    payload => { payload.migrationId = "CHANGED"; },
    payload => { payload.workspaces[0].Name = "CHANGED"; },
    payload => { payload.workspaces[0].IsDefault = false; },
    payload => { payload.workspaces[0].Status = "DISABLED"; },
    payload => { payload.aliases[0].Alias = "CHANGED"; },
    payload => { payload.projectMapping["PRJ-20260716142952"] = "WS0001"; },
    payload => { payload.structuralOperations.reverse(); },
    payload => { payload.structuralOperations[0].after.position = 10; }
  ].forEach((mutate, index) => {
    const changed = MigrationUtils.clone(frozenPayload);
    mutate(changed);
    assertWorkspaceMigration(
      MigrationUtils.checksum(changed) !== frozenFingerprint,
      "Fingerprint non sensibile alla variante " + String(index + 1) + "."
    );
  });

  const spreadsheet = workspaceMigrationFixtureSpreadsheet();
  const dataSource = MigrationDataSource.forSpreadsheet(spreadsheet);
  const taskSnapshot = dataSource.readSheet(CONFIG.SHEETS.TASKS);
  assertWorkspaceMigration(
    taskSnapshot.rows[0].rawValues.slice(TASK_HEADERS.length).join("|") ===
      "derived-left|derived-right",
    "Snapshot Tasks non preserva positionalmente gli header vuoti."
  );
  const preflight = WorkspaceMigration.preflight(dataSource);
  assertWorkspaceMigration(preflight.pass, "Preflight legacy valido rifiutato.");

  const manifest = WorkspaceMigration.manifest(dataSource);
  const backup = BackupEngine.create(dataSource, manifest);
  const dryRun = DryRunEngine.run(manifest, backup);
  assertWorkspaceMigration(dryRun.success, "Dry run completo fallito.");
  assertWorkspaceMigration(dryRun.operations.length === 19,
    "Numero operazioni deterministiche non valido.");

  const writer = MigrationWriter.create(spreadsheet);
  const log = MigrationLog.create(manifest.migrationId);
  manifest.operations.forEach(operation => {
    const result = writer.apply(operation);
    MigrationLog.append(log, {
      operationId: operation.operationId,
      action: operation.action,
      sheet: operation.sheet,
      status: "APPLIED",
      before: result.before,
      after: result.after
    });
  });

  assertWorkspaceMigration(
    MigrationUtils.valuesEqual(
      MigrationDataSource.forSpreadsheet(spreadsheet).readSheet("Projects").headers,
      PROJECT_HEADERS
    ), "WorkspaceID non aggiunta come nona colonna."
  );
  assertWorkspaceMigration(
    spreadsheet.getSheetByName("Workspaces").getLastRow() === 3,
    "Workspace approvati non creati."
  );
  assertWorkspaceMigration(
    spreadsheet.getSheetByName("WorkspaceAliases").getLastRow() === 4,
    "Alias approvati non creati."
  );
  const postflight = WorkspaceMigration.postflight(
    MigrationDataSource.forSpreadsheet(spreadsheet)
  );
  assertWorkspaceMigration(postflight.pass, "Postflight finale fallito.");

  const secondRun = WorkspaceMigration.preflight(
    MigrationDataSource.forSpreadsheet(spreadsheet)
  );
  assertWorkspaceMigration(!secondRun.pass && workspaceHasError(
    secondRun, "WORKSPACES_ALREADY_EXISTS"
  ), "Seconda esecuzione non rifiutata.");

  const report = WorkspaceMigration.report({
    success: true, operations: dryRun.operations, warnings: [], errors: []
  }, "2026-07-17T10:00:00.000Z", "2026-07-17T10:00:01.500Z");
  assertWorkspaceMigration(report.structuralChanges.length === 3,
    "Report modifiche strutturali errato.");
  assertWorkspaceMigration(report.workspacesCreated === 2 &&
    report.aliasesCreated === 3 && report.projectsUpdated === 11 &&
    report.durationMs === 1500 && report.outcome === "SUCCESS",
    "Report finale incompleto.");

  const rollbackPlan = RollbackEngine.buildPlan(MigrationLog.seal(log));
  rollbackPlan.operations.forEach(operation => writer.applyRollback(operation));
  const restored = MigrationDataSource.forSpreadsheet(spreadsheet)
    .readSheet("Projects");
  assertWorkspaceMigration(
    MigrationUtils.valuesEqual(restored.headers, PROJECT_HEADERS.slice(0, 8)),
    "Rollback colonna WorkspaceID non verificato."
  );
  assertWorkspaceMigration(!spreadsheet.getSheetByName("Workspaces") &&
    !spreadsheet.getSheetByName("WorkspaceAliases"),
    "Rollback fogli Workspace non completato."
  );

  workspaceAssertRejected(workspaceMigrationFixtureRows({
    headers: PROJECT_HEADERS
  }), "PROJECTS_SCHEMA_INCOMPATIBLE", "Schema già aggiornato accettato.");
  workspaceAssertRejected(workspaceMigrationFixtureRows({
    headers: ["ID", "Progetto", "BROKEN"]
  }), "PROJECTS_SCHEMA_INCOMPATIBLE", "Schema incompatibile accettato.");
  const approvedLegacyRows = workspaceMigrationFixtureRows({
    headers: [
      "ID", "Progetto", "Stato", "Focus", "Responsabile",
      "Prossima azione", "Creato il", "Ultimo aggiornamento"
    ]
  });
  approvedLegacyRows.Settings = [];
  const approvedLegacyResult = WorkspaceMigration.preflight(
    MigrationDataSource.forSpreadsheet(
      createMigrationTestSpreadsheet(approvedLegacyRows)
    )
  );
  assertWorkspaceMigration(approvedLegacyResult.pass,
    "Schema legacy approvato con Settings vuoto rifiutato.");
  const invalidSettingsRows = workspaceMigrationFixtureRows({});
  invalidSettingsRows.Settings = [["Key", "BROKEN"]];
  workspaceAssertRejected(invalidSettingsRows,
    "SETTINGS_SCHEMA_INCOMPATIBLE", "Schema Settings incompatibile accettato.");
  workspaceAssertRejected(workspaceMigrationFixtureRows({ removeLast: true }),
    "PROJECT_ID_SET_MISMATCH", "Project ID mancante accettato.");
  workspaceAssertRejected(workspaceMigrationFixtureRows({ extraId: "PRJ-EXTRA" }),
    "PROJECT_ID_SET_MISMATCH", "Project ID inatteso accettato.");
  workspaceAssertRejected(workspaceMigrationFixtureRows({ duplicateFirst: true }),
    "PROJECT_ID_DUPLICATE", "Project ID duplicato accettato.");

  const workspaceCollision = workspaceMigrationFixtureRows({});
  workspaceCollision.Workspaces = [WORKSPACE_HEADERS,
    ["WS0001", "LOTAR", true, "ACTIVE", "", ""],
    ["WS0001", "DUP", true, "ACTIVE", "", ""]];
  workspaceCollision.WorkspaceAliases = [WORKSPACE_ALIAS_HEADERS,
    ["Lotar", "WS0001", ""], [" lotar ", "WS9999", ""]];
  const collisionResult = WorkspaceMigration.preflight(
    MigrationDataSource.forSpreadsheet(
      createMigrationTestSpreadsheet(workspaceCollision)
    )
  );
  assertWorkspaceMigration(workspaceHasError(
    collisionResult, "EXISTING_WORKSPACE_ID_DUPLICATE"
  ), "Collisione Workspace ID non rilevata.");
  assertWorkspaceMigration(workspaceHasError(
    collisionResult, "EXISTING_MULTIPLE_DEFAULTS"
  ), "Default multipli non rilevati.");
  assertWorkspaceMigration(workspaceHasError(
    collisionResult, "EXISTING_ALIAS_DUPLICATE"
  ), "Alias duplicati non rilevati.");
  assertWorkspaceMigration(workspaceHasError(
    collisionResult, "EXISTING_ALIAS_ORPHAN"
  ), "Alias orfano non rilevato.");

  return {
    success: true,
    fingerprint: frozenFingerprint,
    fingerprintVariantsRejected: 8,
    operations: manifest.operations.length,
    structuralChanges: report.structuralChanges.length,
    workspacesCreated: report.workspacesCreated,
    aliasesCreated: report.aliasesCreated,
    projectsUpdated: report.projectsUpdated,
    rollbackVerified: true,
    postflightVerified: true,
    collisionsRejected: true,
    secondRunRejected: true
  };
}

function workspaceMigrationFixtureSpreadsheet() {
  return createMigrationTestSpreadsheet(workspaceMigrationFixtureRows({}));
}

function workspaceMigrationFixtureRows(options) {
  options = options || {};
  const headers = options.headers || PROJECT_HEADERS.slice(0, 8);
  let ids = Object.keys(WorkspaceMigration.APPROVED_PROJECT_MAPPING).sort();
  if (options.removeLast) ids = ids.slice(0, -1);
  if (options.extraId) ids.push(options.extraId);
  if (options.duplicateFirst) ids.push(ids[0]);
  return {
    Projects: [headers].concat(ids.map(id => headers.map(header => ({
      ID: id,
      Progetto: "Fixture " + id,
      Status: "IN_PROGRESS",
      Focus: "",
      Responsabile: "Max",
      "Prossima azione": "",
      "Creato il": "2026-07-01T00:00:00.000Z",
      "Ultimo aggiornamento": "2026-07-01T00:00:00.000Z",
      WorkspaceID: ""
    }[header] || "")))),
    Tasks: [TASK_HEADERS.concat(["", ""])].concat([[
      "TSK-WORKSPACE-FIXTURE", ids[0], "Fixture task", "",
      CONFIG.TASK_STATUS.OPEN, CONFIG.TASK_PRIORITY.NORMAL,
      CONFIG.DEFAULT_OWNER, "", "2026-07-01T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z", "", "derived-left", "derived-right"
    ]]),
    Timeline: [TIMELINE_HEADERS],
    Settings: [SETTINGS_HEADERS]
  };
}

function workspaceAssertRejected(rows, code, message) {
  const result = WorkspaceMigration.preflight(
    MigrationDataSource.forSpreadsheet(createMigrationTestSpreadsheet(rows))
  );
  assertWorkspaceMigration(!result.pass && workspaceHasError(result, code), message);
}

function workspaceHasError(result, code) {
  return result.errors.some(error => error.code === code);
}

function assertWorkspaceMigration(condition, message) {
  if (!condition) throw new Error(message);
}
