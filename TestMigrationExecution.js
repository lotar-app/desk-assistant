function testMigrationExecutionFramework() {

  const fixture = migrationExecutionFixture();
  const spreadsheet = createMigrationTestSpreadsheet(fixture.sheets);
  const manifest = fixture.manifest;
  const dataSource = MigrationDataSource.forSpreadsheet(spreadsheet);
  const backup = BackupEngine.create(dataSource, manifest);
  const dryRun = DryRunEngine.run(manifest, backup);
  const copySpreadsheet = createMigrationTestSpreadsheet(fixture.sheets);
  const physicalBackup = BackupEngine.createPhysical(
    backup,
    manifest,
    {
      services: migrationBackupTestServices(
        spreadsheet,
        copySpreadsheet
      )
    }
  );

  assertMigrationExecution(dryRun.success, "Dry run fixture non riuscito.");
  assertMigrationExecution(
    physicalBackup.verified,
    "Backup fisico fixture non verificato."
  );

  const lock = migrationTestLock();
  const logRepository = MigrationLogRepository.create(spreadsheet);
  const dependencies = {
    dataSource: dataSource,
    writer: MigrationWriter.create(spreadsheet),
    logRepository: logRepository,
    lock: lock,
    spreadsheetId: spreadsheet.getId()
  };
  const preparedManifest = MigrationManifest.prepare(manifest);
  const execution = MigrationExecutor.execute(
    manifest,
    backup,
    dryRun,
    physicalBackup,
    {
      confirmed: true,
      migrationId: manifest.migrationId,
      checksum: preparedManifest.checksum,
      backupChecksum: backup.checksum,
      phrase: "APPLY " + manifest.migrationId
    },
    dependencies
  );

  assertMigrationExecution(execution.success, "Migrazione fixture non riuscita.");
  assertMigrationExecution(
    migrationTestCell(spreadsheet, "Tasks", 2, 3) === "Completata",
    "La task fixture non è stata completata."
  );
  assertMigrationExecution(
    spreadsheet.getSheetByName("Projects").getLastRow() === 3,
    "Il progetto fixture non è stato creato."
  );

  const persistedLog = logRepository.read(manifest.migrationId);
  assertMigrationExecution(persistedLog.valid, "MigrationLog non valido.");
  assertMigrationExecution(
    persistedLog.entries.filter(entry => entry.status === "APPLIED").length === 2,
    "Numero operazioni APPLIED non valido."
  );

  const rollbackPlan = RollbackEngine.buildPlan(persistedLog, {
    executable: true
  });
  const rollback = RollbackEngine.execute(
    rollbackPlan,
    physicalBackup,
    {
      confirmed: true,
      migrationId: manifest.migrationId,
      checksum: rollbackPlan.checksum,
      backupChecksum: physicalBackup.sourceChecksum,
      phrase: "ROLLBACK " + manifest.migrationId
    },
    {
      writer: MigrationWriter.create(spreadsheet),
      logRepository: logRepository,
      lock: lock,
      spreadsheetId: spreadsheet.getId()
    }
  );

  assertMigrationExecution(rollback.success, "Rollback fixture non riuscito.");
  assertMigrationExecution(
    migrationTestCell(spreadsheet, "Tasks", 2, 3) === "Aperta",
    "La task fixture non è stata ripristinata."
  );
  assertMigrationExecution(
    spreadsheet.getSheetByName("Projects").getLastRow() === 2,
    "Il progetto creato non è stato rimosso dal rollback."
  );
  const postRollbackPlan = RollbackEngine.buildPlan(
    logRepository.read(manifest.migrationId),
    { executable: true }
  );
  assertMigrationExecution(
    postRollbackPlan.operations.length === 0,
    "Le operazioni già compensate sono ricomparse nel rollback."
  );
  assertMigrationExecution(
    lock.acquired === 2 && lock.released === 2,
    "Lock non acquisito o rilasciato correttamente."
  );

  let realManifestRejected = false;
  try {
    MigrationSafetyGuard.assertExecution(
      V14_DATA_FOUNDATION_MANIFEST,
      backup,
      dryRun,
      physicalBackup,
      {}
    );
  } catch (error) {
    realManifestRejected = error.message.indexOf("non è autorizzato") !== -1;
  }
  assertMigrationExecution(
    realManifestRejected,
    "Il manifesto reale DRY_RUN_ONLY non è stato bloccato."
  );

  let invalidConfirmationRejected = false;
  try {
    MigrationSafetyGuard.assertConfirmation(
      { confirmed: true },
      manifest.migrationId,
      "checksum",
      backup.checksum,
      "APPLY " + manifest.migrationId
    );
  } catch (error) {
    invalidConfirmationRejected = true;
  }
  assertMigrationExecution(
    invalidConfirmationRejected,
    "Una conferma incompleta non è stata rifiutata."
  );

  const driftSpreadsheet = createMigrationTestSpreadsheet(fixture.sheets);
  const driftDataSource = MigrationDataSource.forSpreadsheet(driftSpreadsheet);
  const driftBackup = BackupEngine.create(driftDataSource, manifest);
  const driftDryRun = DryRunEngine.run(manifest, driftBackup);
  driftSpreadsheet
    .getSheetByName("Tasks")
    .getRange(2, 3, 1, 1)
    .setValues([["MODIFICATA"]]);
  let driftRejected = false;

  try {
    MigrationExecutor.execute(
      manifest,
      driftBackup,
      driftDryRun,
      physicalBackup,
      {
        confirmed: true,
        migrationId: manifest.migrationId,
        checksum: MigrationManifest.prepare(manifest).checksum,
        backupChecksum: driftBackup.checksum,
        phrase: "APPLY " + manifest.migrationId
      },
      {
        dataSource: driftDataSource,
        writer: MigrationWriter.create(driftSpreadsheet),
        logRepository: MigrationLogRepository.create(driftSpreadsheet),
        lock: migrationTestLock(),
        spreadsheetId: driftSpreadsheet.getId()
      }
    );
  } catch (error) {
    driftRejected = error.message.indexOf("è cambiato") !== -1;
  }

  assertMigrationExecution(
    driftRejected,
    "La variazione successiva al dry run non è stata rifiutata."
  );
  assertMigrationExecution(
    !driftSpreadsheet.getSheetByName(CONFIG.SHEETS.MIGRATION_LOG),
    "MigrationLog creato nonostante la baseline divergente."
  );

  const encodedDate = MigrationRecordCodec.encode({ value: new Date(0) });
  const decodedDate = MigrationRecordCodec.decode(encodedDate);
  assertMigrationExecution(
    decodedDate.value instanceof Date && decodedDate.value.getTime() === 0,
    "Codec Date non valido."
  );

  const persistedEntries = logRepository.read(manifest.migrationId).entries.length;
  spreadsheet
    .getSheetByName(CONFIG.SHEETS.MIGRATION_LOG)
    .getRange(2, MIGRATION_LOG_HEADERS.length, 1, 1)
    .setValues([["TAMPERED"]]);
  const tamperedLog = logRepository.read(manifest.migrationId);
  assertMigrationExecution(
    tamperedLog.valid === false,
    "La manomissione del MigrationLog non è stata rilevata."
  );

  return {
    success: true,
    physicalBackupVerified: physicalBackup.verified,
    appliedOperations: execution.appliedOperations.length,
    rollbackOperations: rollback.rollbackOperations.length,
    persistentLogEntries: persistedEntries,
    realManifestRejected: realManifestRejected,
    invalidConfirmationRejected: invalidConfirmationRejected,
    driftRejectedBeforeWrites: driftRejected,
    tamperDetected: true
  };

}

function migrationExecutionFixture() {
  const sheets = {
    Projects: [
      ["ID", "Progetto", "Stato", "Creato il"],
      ["PRJ-1", "Fixture", "IN_PROGRESS", new Date(0)]
    ],
    Tasks: [
      ["ID", "ProjectID", "Status"],
      ["TSK-1", "PRJ-1", "Aperta"]
    ],
    Timeline: [["Data", "Project ID", "Tipo", "Descrizione"]],
    Settings: []
  };
  const manifest = {
    migrationId: "TEST_EXECUTION",
    version: "test",
    mode: "EXECUTION_APPROVED",
    baseline: {
      sheets: {
        Projects: {
          recordCount: 1,
          requiredHeaders: ["ID", "Progetto", "Stato", "Creato il"],
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
        Settings: { recordCount: 0, requiredHeaders: [] }
      }
    },
    operations: [{
      operationId: "TEST-COMPLETE",
      action: "COMPLETE",
      sheet: "Tasks",
      selector: { ID: "TSK-1", Status: "Aperta" },
      after: { Status: "Completata" }
    }, {
      operationId: "TEST-CREATE",
      action: "CREATE",
      sheet: "Projects",
      selector: { ID: "PRJ-2" },
      after: {
        ID: "PRJ-2",
        Progetto: "Created",
        Stato: "IN_PROGRESS",
        "Creato il": MigrationRecordCodec.encode(new Date(1000))
      }
    }]
  };

  return { sheets: sheets, manifest: manifest };
}

function createMigrationTestSpreadsheet(initialSheets) {
  const sheets = {};

  Object.keys(initialSheets).forEach(name => {
    sheets[name] = createMigrationTestSheet(name, initialSheets[name]);
  });

  return {
    getId() { return "TEST-SPREADSHEET"; },
    getName() { return "Desk Test"; },
    getSheetByName(name) { return sheets[name] || null; },
    insertSheet(name) {
      if (sheets[name]) {
        throw new Error("Foglio già esistente: " + name);
      }
      sheets[name] = createMigrationTestSheet(name, []);
      return sheets[name];
    }
  };
}

function createMigrationTestSheet(name, initialRows) {
  const rows = initialRows.map(row => row.slice());

  function range(row, column, rowCount, columnCount) {
    return {
      getValues() {
        const result = [];
        for (let r = 0; r < rowCount; r++) {
          const values = [];
          for (let c = 0; c < columnCount; c++) {
            values.push(
              rows[row - 1 + r] && rows[row - 1 + r][column - 1 + c] !== undefined
                ? rows[row - 1 + r][column - 1 + c]
                : ""
            );
          }
          result.push(values);
        }
        return result;
      },
      setValues(values) {
        for (let r = 0; r < rowCount; r++) {
          if (!rows[row - 1 + r]) {
            rows[row - 1 + r] = [];
          }
          for (let c = 0; c < columnCount; c++) {
            rows[row - 1 + r][column - 1 + c] = values[r][c];
          }
        }
      }
    };
  }

  return {
    getName() { return name; },
    getLastRow() { return rows.length; },
    getLastColumn() {
      return rows.reduce((max, row) => Math.max(max, row.length), 0);
    },
    getDataRange() {
      return range(1, 1, rows.length, this.getLastColumn());
    },
    getRange(row, column, rowCount, columnCount) {
      return range(row, column, rowCount, columnCount);
    },
    appendRow(values) { rows.push(values.slice()); },
    deleteRow(rowNumber) { rows.splice(rowNumber - 1, 1); }
  };
}

function migrationBackupTestServices(sourceSpreadsheet, copiedSpreadsheet) {
  const folder = {
    createFile() {
      return {
        getId() { return "TEST-XLSX"; },
        getSize() { return 1024; }
      };
    }
  };
  const sourceFile = {
    getId() { return sourceSpreadsheet.getId(); }
  };

  return {
    getActiveSpreadsheet() { return sourceSpreadsheet; },
    getFileById() { return sourceFile; },
    getParentFolder() { return folder; },
    makeCopy() {
      return { getId() { return "TEST-COPY"; } };
    },
    openSpreadsheetById() { return copiedSpreadsheet; },
    exportXlsx() { return { name: "backup.xlsx" }; },
    createFile() { return folder.createFile(); }
  };
}

function migrationTestLock() {
  return {
    acquired: 0,
    released: 0,
    tryLock() { this.acquired++; return true; },
    releaseLock() { this.released++; }
  };
}

function migrationTestCell(spreadsheet, sheetName, row, column) {
  return spreadsheet
    .getSheetByName(sheetName)
    .getRange(row, column, 1, 1)
    .getValues()[0][0];
}

function assertMigrationExecution(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
