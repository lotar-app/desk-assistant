function testMigrationFramework() {

  const writes = [];
  const fixture = migrationFrameworkFixture();
  const dataSource = {
    readSheet(name) {
      return MigrationUtils.clone(fixture.sheets[name]);
    },
    writeSheet() {
      writes.push("writeSheet");
      throw new Error("Il dry run non deve scrivere.");
    }
  };
  const manifest = fixture.manifest;
  const backup = BackupEngine.create(dataSource, manifest);
  const baseline = BaselineValidator.validate(backup, manifest);
  const dryRun = DryRunEngine.run(manifest, backup);

  assertMigrationFramework(backup.readOnly === true, "Backup non read-only.");
  assertMigrationFramework(!!backup.checksum, "Checksum backup mancante.");
  assertMigrationFramework(baseline.valid === true, "Baseline non valida.");
  assertMigrationFramework(dryRun.success === true, "Dry run non riuscito.");
  assertMigrationFramework(dryRun.dryRun === true, "Flag dry run mancante.");
  assertMigrationFramework(writes.length === 0, "Il dry run ha scritto dati.");

  const divergent = MigrationUtils.clone(backup);
  divergent.sheets.Projects.rows[0].values.ID = "DIVERGENT";
  const rejected = BaselineValidator.validate(divergent, manifest);

  assertMigrationFramework(
    rejected.valid === false,
    "La baseline divergente non è stata rifiutata."
  );

  const appliedLog = MigrationLog.create(manifest.migrationId);
  MigrationLog.append(appliedLog, {
    operationId: "TEST-UPDATE",
    action: "UPDATE",
    sheet: "Projects",
    status: "APPLIED",
    before: { ID: "PRJ-1", Status: "WAITING" },
    after: { ID: "PRJ-1", Status: "IN_PROGRESS" }
  });
  const rollback = RollbackEngine.buildPlan(MigrationLog.seal(appliedLog));

  assertMigrationFramework(rollback.readOnly === true, "Rollback non read-only.");
  assertMigrationFramework(rollback.executable === false, "Rollback eseguibile.");
  assertMigrationFramework(
    rollback.operations[0].action === "RESTORE",
    "Azione rollback non corretta."
  );

  return {
    success: true,
    backupChecksum: backup.checksum,
    manifestChecksum: dryRun.manifestChecksum,
    operations: dryRun.summary,
    rollbackOperations: rollback.operations.length,
    writes: writes.length
  };

}

function migrationFrameworkFixture() {

  const sheets = {
    Projects: {
      name: "Projects",
      headers: ["ID", "Progetto", "Status"],
      rows: [{
        rowNumber: 2,
        values: { ID: "PRJ-1", Progetto: "Fixture", Status: "IN_PROGRESS" }
      }]
    },
    Tasks: {
      name: "Tasks",
      headers: ["ID", "ProjectID", "Status"],
      rows: [{
        rowNumber: 2,
        values: { ID: "TSK-1", ProjectID: "PRJ-1", Status: "Aperta" }
      }]
    },
    Timeline: {
      name: "Timeline",
      headers: ["Data", "Project ID", "Tipo", "Descrizione"],
      rows: []
    },
    Settings: {
      name: "Settings",
      headers: [],
      rows: []
    }
  };
  const manifest = {
    migrationId: "TEST_MIGRATION",
    version: "test",
    baseline: {
      sheets: {
        Projects: {
          recordCount: 1,
          requiredHeaders: ["ID", "Progetto", "Status"],
          idField: "ID",
          ids: ["PRJ-1"]
        },
        Tasks: {
          recordCount: 1,
          requiredHeaders: ["ID", "ProjectID", "Status"],
          idField: "ID",
          ids: ["TSK-1"]
        },
        Timeline: {
          recordCount: 0,
          requiredHeaders: ["Data", "Project ID", "Tipo", "Descrizione"]
        },
        Settings: {
          recordCount: 0,
          requiredHeaders: []
        }
      }
    },
    operations: [{
      operationId: "TEST-COMPLETE-TASK",
      action: "COMPLETE",
      sheet: "Tasks",
      selector: { ID: "TSK-1", Status: "Aperta" },
      after: { Status: "Completata" }
    }, {
      operationId: "TEST-CREATE-PROJECT",
      action: "CREATE",
      sheet: "Projects",
      selector: { ID: "PRJ-2" },
      after: { ID: "PRJ-2", Progetto: "Nuovo" }
    }]
  };

  return {
    sheets: sheets,
    manifest: manifest
  };

}

function assertMigrationFramework(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
