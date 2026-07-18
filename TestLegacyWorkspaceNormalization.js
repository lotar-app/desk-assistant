function testLegacyWorkspaceNormalization() {
  const rows = legacyWorkspaceNormalizationFixtureRows();
  const spreadsheet = legacyWorkspaceNormalizationTestSpreadsheet(rows);
  const dataSource = MigrationDataSource.forSpreadsheet(spreadsheet);
  const preflight = LegacyWorkspaceNormalization.preflight(dataSource);
  assertLegacyWorkspaceNormalization(preflight.pass,
    "Baseline nominale valida rifiutata.");

  const manifest = LegacyWorkspaceNormalization.manifest(dataSource);
  const approvedManifest = MigrationUtils.clone(manifest);
  approvedManifest.mode = "EXECUTION_APPROVED";
  delete approvedManifest.manifestChecksum;
  delete approvedManifest.manifestSignature;
  const approvedPrepared = MigrationManifest.prepare(approvedManifest);
  approvedManifest.manifestChecksum = approvedPrepared.checksum;
  approvedManifest.manifestSignature = approvedPrepared.signature;
  const backup = BackupEngine.create(dataSource, approvedManifest);
  const physicalBackup = {
    migrationId: approvedManifest.migrationId,
    verified: true,
    sourceChecksum: backup.checksum,
    spreadsheetCopyId: "TEST-COPY",
    xlsxFileId: "TEST-XLSX"
  };
  physicalBackup.checksum = MigrationUtils.checksum(physicalBackup);
  const confirmation = {
    confirmed: true,
    phrase: "APPLY " + approvedManifest.migrationId,
    fingerprint: approvedManifest.fingerprint,
    manifestChecksum: approvedManifest.manifestChecksum,
    baselineChecksum: approvedManifest.baselineState.projectsChecksum,
    backupId: physicalBackup.spreadsheetCopyId
  };
  const lock = legacyWorkspaceNormalizationTestLock();
  const execution = LegacyWorkspaceNormalizationExecutor.execute(
    spreadsheet, approvedManifest, physicalBackup, confirmation, { lock: lock }
  );
  assertLegacyWorkspaceNormalization(execution.success,
    "Esecuzione fixture fallita.");
  assertLegacyWorkspaceNormalization(
    spreadsheet.getSheetByName("Projects").getLastColumn() === 8,
    "Projects non normalizzato a otto colonne.");

  const rollbackConfirmation = {
    confirmed: true,
    phrase: "ROLLBACK " + approvedManifest.migrationId,
    fingerprint: approvedManifest.fingerprint,
    manifestChecksum: approvedManifest.manifestChecksum,
    backupId: physicalBackup.spreadsheetCopyId
  };
  const rollback = LegacyWorkspaceNormalizationExecutor.rollback(
    spreadsheet, approvedManifest, physicalBackup,
    rollbackConfirmation, { lock: legacyWorkspaceNormalizationTestLock() }
  );
  assertLegacyWorkspaceNormalization(rollback.restored,
    "Rollback fixture fallito.");
  assertLegacyWorkspaceNormalization(
    LegacyWorkspaceNormalization.preflight(
      MigrationDataSource.forSpreadsheet(spreadsheet)
    ).pass,
    "Baseline nominale non ripristinata.");

  legacyWorkspaceNormalizationNegativeTests();
  legacyWorkspaceNormalizationFailureTests(
    approvedManifest, physicalBackup, confirmation
  );

  return {
    success: true,
    fingerprint: preflight.fingerprint,
    projectCount: preflight.projectCount,
    executionVerified: true,
    rollbackVerified: true,
    negativeTests: 9,
    failureInjectionVerified: true
  };
}

function legacyWorkspaceNormalizationNegativeTests() {
  const cases = [{ mutate(rows) { rows.Projects[0][2] = "Status"; },
    code: "PROJECTS_SCHEMA_INCOMPATIBLE" },
  { mutate(rows) { rows.Projects[0][8] = "workspace"; },
    code: "PROJECTS_SCHEMA_INCOMPATIBLE" },
  { mutate(rows) { rows.Projects[1][8] = "lotar"; },
    code: "LEGACY_WORKSPACE_MISMATCH" },
  { mutate(rows) { rows.Projects[1][8] = ""; },
    code: "LEGACY_WORKSPACE_MISMATCH" },
  { mutate(rows) { rows.Projects[2][0] = rows.Projects[1][0]; },
    code: "PROJECT_ID_DUPLICATE" },
  { mutate(rows) { rows.Projects.pop(); }, code: "PROJECT_COUNT_MISMATCH" },
  { mutate(rows) { rows.Workspaces = [WORKSPACE_HEADERS]; },
    code: "WORKSPACES_ALREADY_EXISTS" },
  { mutate(rows) { rows.WorkspaceAliases = [WORKSPACE_ALIAS_HEADERS]; },
    code: "ALIASES_ALREADY_EXISTS" }];
  cases.forEach(testCase => {
    const rows = legacyWorkspaceNormalizationFixtureRows();
    testCase.mutate(rows);
    const result = LegacyWorkspaceNormalization.preflight(
      MigrationDataSource.forSpreadsheet(
        legacyWorkspaceNormalizationTestSpreadsheet(rows)
      )
    );
    assertLegacyWorkspaceNormalization(!result.pass && result.errors.some(error => (
      error.code === testCase.code
    )), "Caso negativo non rifiutato: " + testCase.code);
  });
  const formulaRows = legacyWorkspaceNormalizationFixtureRows();
  const formulaSpreadsheet = legacyWorkspaceNormalizationTestSpreadsheet(
    formulaRows
  );
  const formulaSource = LegacyWorkspaceNormalization.forSpreadsheet(
    formulaSpreadsheet
  );
  formulaSource.readProjectFormulas = () => [["=\"LOTAR\""]];
  const formulaResult = LegacyWorkspaceNormalization.preflight(formulaSource);
  assertLegacyWorkspaceNormalization(formulaResult.errors.some(error => (
    error.code === "LEGACY_WORKSPACE_FORMULA"
  )), "Formula workspace nominale non rifiutata.");
}

function legacyWorkspaceNormalizationFailureTests(
  approvedManifest, physicalBackup, confirmation
) {
  const spreadsheet = legacyWorkspaceNormalizationTestSpreadsheet(
    legacyWorkspaceNormalizationFixtureRows()
  );
  let failed = false;
  try {
    LegacyWorkspaceNormalizationExecutor.execute(
      spreadsheet, approvedManifest, physicalBackup, confirmation,
      { lock: legacyWorkspaceNormalizationTestLock(), failAfterWrite: true }
    );
  } catch (error) {
    failed = error.message === "FAILURE_INJECTION_AFTER_WRITE" &&
      error.migrationReport.outcome === "FAILED_REQUIRES_ROLLBACK";
  }
  assertLegacyWorkspaceNormalization(failed,
    "Failure injection non rilevata.");
}

function legacyWorkspaceNormalizationFixtureRows() {
  const mapping = LegacyWorkspaceNormalization.APPROVED_LEGACY_MAPPING;
  const ids = Object.keys(mapping).sort();
  return {
    Projects: [LegacyWorkspaceNormalization.ACCEPTED_HEADERS.slice()].concat(
      ids.map(id => [id, "Fixture " + id, "IN_PROGRESS", "", "Max", "",
        "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z", mapping[id]])
    ),
    Tasks: [TASK_HEADERS],
    Timeline: [TIMELINE_HEADERS],
    Settings: []
  };
}

function assertLegacyWorkspaceNormalization(condition, message) {
  if (!condition) throw new Error(message);
}

function legacyWorkspaceNormalizationTestSpreadsheet(initialSheets) {
  const sheets = {};
  Object.keys(initialSheets).forEach(name => {
    sheets[name] = legacyWorkspaceNormalizationTestSheet(
      name, initialSheets[name]
    );
  });
  return {
    getId() { return "LEGACY-NORMALIZATION-TEST"; },
    getName() { return "Legacy Normalization Test"; },
    getSheetByName(name) { return sheets[name] || null; },
    insertSheet(name) {
      sheets[name] = legacyWorkspaceNormalizationTestSheet(name, []);
      return sheets[name];
    }
  };
}

function legacyWorkspaceNormalizationTestSheet(name, initialRows) {
  const rows = initialRows.map(row => row.slice());
  function effectiveLastColumn() {
    return rows.reduce((max, row) => {
      let last = 0;
      row.forEach((value, index) => {
        if (value !== "" && value !== null && value !== undefined) last = index + 1;
      });
      return Math.max(max, last);
    }, 0);
  }
  function range(row, column, rowCount, columnCount) {
    return {
      getValues() {
        return Array.from({ length: rowCount }, (_, r) => (
          Array.from({ length: columnCount }, (_, c) => (
            rows[row - 1 + r] && rows[row - 1 + r][column - 1 + c] !== undefined
              ? rows[row - 1 + r][column - 1 + c] : ""
          ))
        ));
      },
      getFormulas() {
        return Array.from({ length: rowCount }, () => (
          Array.from({ length: columnCount }, () => "")
        ));
      },
      setValues(values) {
        values.forEach((sourceRow, r) => {
          if (!rows[row - 1 + r]) rows[row - 1 + r] = [];
          sourceRow.forEach((value, c) => {
            rows[row - 1 + r][column - 1 + c] = value;
          });
        });
      }
    };
  }
  return {
    getName() { return name; },
    getLastRow() { return rows.length; },
    getLastColumn() { return effectiveLastColumn(); },
    getDataRange() {
      return range(1, 1, rows.length, effectiveLastColumn());
    },
    getRange(row, column, rowCount, columnCount) {
      return range(row, column, rowCount, columnCount);
    },
    deleteColumn(column) { rows.forEach(row => row.splice(column - 1, 1)); },
    insertColumnAfter(column) { rows.forEach(row => row.splice(column, 0, "")); }
  };
}

function legacyWorkspaceNormalizationTestLock() {
  return {
    tryLock() { return true; },
    releaseLock() {}
  };
}

function testLegacyWorkspaceNormalizationIntegration() {
  const name = "TEMP-LEGACY-WORKSPACE-NORMALIZATION-" + new Date().getTime();
  const spreadsheet = SpreadsheetApp.create(name);
  const file = DriveApp.getFileById(spreadsheet.getId());
  try {
    const defaultSheet = spreadsheet.getSheets()[0];
    defaultSheet.setName(CONFIG.SHEETS.PROJECTS);
    const fixture = legacyWorkspaceNormalizationFixtureRows();
    defaultSheet.getRange(
      1, 1, fixture.Projects.length, fixture.Projects[0].length
    ).setValues(fixture.Projects);
    [CONFIG.SHEETS.TASKS, CONFIG.SHEETS.TIMELINE, CONFIG.SHEETS.SETTINGS]
      .forEach(name => {
        const sheet = spreadsheet.insertSheet(name);
        const rows = fixture[name];
        if (rows.length) {
          sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
        }
      });
    SpreadsheetApp.flush();
    const source = LegacyWorkspaceNormalization.forSpreadsheet(spreadsheet);
    const preflight = LegacyWorkspaceNormalization.preflight(source);
    assertLegacyWorkspaceNormalization(preflight.pass,
      "Preflight integrazione fallito.");
    const manifest = LegacyWorkspaceNormalization.manifest(source);
    const writer = LegacyWorkspaceNormalizationWriter.create(spreadsheet);
    writer.apply(manifest.operations[0], manifest);
    SpreadsheetApp.flush();
    const postflight = LegacyWorkspaceNormalization.postflight(
      LegacyWorkspaceNormalization.forSpreadsheet(spreadsheet), manifest
    );
    assertLegacyWorkspaceNormalization(postflight.pass,
      "Postflight integrazione fallito.");
    writer.rollback(manifest.operations[0], manifest);
    SpreadsheetApp.flush();
    const restored = LegacyWorkspaceNormalization.preflight(
      LegacyWorkspaceNormalization.forSpreadsheet(spreadsheet)
    );
    assertLegacyWorkspaceNormalization(restored.pass,
      "Rollback integrazione fallito.");
    return { success: true, temporarySpreadsheetId: spreadsheet.getId(),
      preflight: preflight.status, postflight: postflight.status,
      rollback: "VERIFIED" };
  } finally {
    file.setTrashed(true);
  }
}
