const TaskIdRepairMigration = {

  MIGRATION_ID: "TASK_ID_REPAIR_V1",
  VERSION: "1.0.0",
  MODE: "VALIDATED_CLOSED",
  HISTORICAL_MANIFEST_MODE: "EXECUTION_READY",
  STATUS: "VALIDATED_CLOSED",
  CLOSED: true,
  TASK_COUNT: 40,
  TASKS_CHECKSUM: "3d420bb30fc2c7e95021ba995172ac1d1af6a5a8d097d01ae00cd67bc3740d44",
  EXPECTED_EXTRA_HEADERS: ["", ""],
  EXPECTED_DUPLICATE_IDS: [
    "TSK-20260714131725",
    "TSK-20260714131729",
    "TSK-20260716121446"
  ],

  FROZEN_REPAIR_ENTRIES: [{
    rowNumber: 13,
    oldTaskId: "TSK-20260714131725",
    rowHash: "4252c9c2890b1907d81c0b1678a7acf4ea8e223d925adcbe338e8a88b65d1f85",
    newTaskId: "TSK-20260714131725-R02"
  }, {
    rowNumber: 18,
    oldTaskId: "TSK-20260714131729",
    rowHash: "95dcd4428b302953aac773d71a963419000e5a79e1c8a1d434f14084dc222eaf",
    newTaskId: "TSK-20260714131729-R02"
  }, {
    rowNumber: 38,
    oldTaskId: "TSK-20260716121446",
    rowHash: "65273d6f0920eb403cac17c011d7287fd31cb04115482a1510e8ac3349a6305b",
    newTaskId: "TSK-20260716121446-R02"
  }],

  diagnose(dataSource) {
    dataSource = dataSource || MigrationDataSource.forSpreadsheet(
      SpreadsheetApp.getActiveSpreadsheet()
    );
    const tasks = dataSource.readSheet(CONFIG.SHEETS.TASKS);
    const groups = {};
    tasks.rows.forEach(row => {
      const id = String(row.values.ID || "").trim();
      if (!groups[id]) groups[id] = [];
      groups[id].push({
        rowNumber: row.rowNumber,
        rowHash: this.rowHash(row.values),
        values: MigrationUtils.clone(row.values)
      });
    });
    const duplicates = Object.keys(groups).filter(id => groups[id].length > 1)
      .sort().map(id => ({
        taskId: id,
        occurrences: groups[id].length,
        rows: groups[id]
      }));
    return {
      readOnly: true,
      schemaValid: tasks.exists !== false && this.schemaValid(tasks.headers),
      actualHeaders: tasks.headers.slice(),
      extraHeaders: tasks.headers.slice(TASK_HEADERS.length),
      taskCount: tasks.rows.length,
      taskIds: tasks.rows.map(row => String(row.values.ID || "").trim()),
      tasksChecksum: MigrationUtils.checksum(tasks),
      duplicates: duplicates
    };
  },

  buildManifest(approvedEntries, dataSource) {
    const diagnosis = this.diagnose(dataSource);
    const validation = this.validateApprovedEntries(approvedEntries, diagnosis);
    if (!validation.pass) {
      throw new Error("Manifesto Task ID Repair non congelabile: " +
        validation.errors.join("; "));
    }
    if (!MigrationUtils.valuesEqual(
      approvedEntries, this.FROZEN_REPAIR_ENTRIES
    )) {
      throw new Error("Le repairEntries non coincidono con il manifesto congelato.");
    }
    if (diagnosis.taskCount !== this.TASK_COUNT ||
        diagnosis.tasksChecksum !== this.TASKS_CHECKSUM) {
      throw new Error("La baseline Tasks non coincide con il manifesto congelato.");
    }
    return this.frozenManifest();
  },

  frozenManifest() {
    const entries = MigrationUtils.clone(this.FROZEN_REPAIR_ENTRIES);
    const operations = entries.map((entry, index) => ({
      operationId: "TASK-ID-REPAIR-" + String(index + 1).padStart(3, "0"),
      action: "UPDATE",
      sheet: CONFIG.SHEETS.TASKS,
      selector: { _rowNumber: entry.rowNumber, ID: entry.oldTaskId },
      after: { ID: entry.newTaskId },
      expectedRowHash: entry.rowHash,
      reason: "Riparazione esplicita Task ID duplicato; nessun altro campo autorizzato."
    }));
    const manifest = {
      migrationId: this.MIGRATION_ID,
      version: this.VERSION,
      mode: this.HISTORICAL_MANIFEST_MODE,
      baseline: { sheets: { Tasks: {
        recordCount: this.TASK_COUNT,
        requiredHeaders: TASK_HEADERS
      }}},
      tasksChecksum: this.TASKS_CHECKSUM,
      taskCount: this.TASK_COUNT,
      expectedHeaders: TASK_HEADERS.slice(),
      expectedExtraHeaders: this.EXPECTED_EXTRA_HEADERS.slice(),
      expectedDuplicateIds: this.EXPECTED_DUPLICATE_IDS.slice(),
      repairEntries: entries,
      operations: operations
    };
    manifest.fingerprint = MigrationUtils.checksum(manifest);
    return manifest;
  },

  preflight(manifest, dataSource) {
    const diagnosis = this.diagnose(dataSource);
    const errors = [];
    if (this.CLOSED === true) {
      errors.push("TASK_ID_REPAIR_V1 è VALIDATED_CLOSED e non può essere rieseguita.");
    }
    if (!manifest || manifest.migrationId !== this.MIGRATION_ID) {
      errors.push("Migration ID non valido.");
    }
    if (!manifest || manifest.mode !== "EXECUTION_READY") {
      errors.push("Il manifesto deve essere EXECUTION_READY.");
    }
    if (!diagnosis.schemaValid) errors.push("Schema Tasks non valido.");
    if (!MigrationUtils.valuesEqual(
      diagnosis.extraHeaders, this.EXPECTED_EXTRA_HEADERS
    )) {
      errors.push("Le colonne vuote finali non coincidono con il manifesto.");
    }
    if (manifest && diagnosis.tasksChecksum !== manifest.tasksChecksum) {
      errors.push("Il foglio Tasks è cambiato rispetto al manifesto.");
    }
    const validation = this.validateApprovedEntries(
      manifest ? manifest.repairEntries : [], diagnosis
    );
    errors.push.apply(errors, validation.errors);
    if (manifest) {
      const copy = MigrationUtils.clone(manifest);
      const fingerprint = copy.fingerprint;
      delete copy.fingerprint;
      if (MigrationUtils.checksum(copy) !== fingerprint) {
        errors.push("Fingerprint manifesto non valido.");
      }
    }
    return {
      readOnly: true,
      pass: errors.length === 0,
      migrationId: this.MIGRATION_ID,
      errors: errors,
      diagnosis: diagnosis
    };
  },

  postflight(manifest, dataSource, baselineTasks) {
    const tasks = dataSource.readSheet(CONFIG.SHEETS.TASKS);
    const errors = [];
    const changedRows = {};
    const baselineRows = baselineTasks && Array.isArray(baselineTasks.rows)
      ? baselineTasks.rows : [];
    (manifest.repairEntries || []).forEach(entry => {
      changedRows[Number(entry.rowNumber)] = entry;
    });
    if (!baselineTasks || !Array.isArray(baselineTasks.rows)) {
      errors.push("Baseline Tasks obbligatoria per il postflight.");
    }
    tasks.rows.forEach(row => {
      const entry = changedRows[Number(row.rowNumber)];
      const baselineRow = baselineRows.find(candidate => (
        Number(candidate.rowNumber) === Number(row.rowNumber)
      ));
      if (!baselineRow) {
        errors.push("Riga baseline mancante: " + row.rowNumber + ".");
        return;
      }
      if (entry) {
        if (String(row.values.ID) !== entry.newTaskId) {
          errors.push("Nuovo ID divergente alla riga " + entry.rowNumber + ".");
        }
        if (String(baselineRow.values.ID || "") !== entry.oldTaskId ||
            this.taskContentHash(row.values) !==
              this.taskContentHash(baselineRow.values)) {
          errors.push("Campi non autorizzati modificati alla riga " +
            entry.rowNumber + ".");
        }
      } else if (!MigrationUtils.valuesEqual(
        this.canonicalTaskRecord(row.values),
        this.canonicalTaskRecord(baselineRow.values)
      )) {
        errors.push("Riga non autorizzata modificata: " + row.rowNumber + ".");
      }
    });
    if (tasks.rows.length !== baselineRows.length) {
      errors.push("Numero task divergente dalla baseline.");
    }
    const ids = tasks.rows.map(row => String(row.values.ID || "").trim());
    if (this.duplicates(ids).length > 0) errors.push("Task ID duplicati residui.");
    return {
      readOnly: true,
      pass: errors.length === 0,
      taskCount: tasks.rows.length,
      changedRows: Object.keys(changedRows).map(Number).sort((a, b) => a - b),
      checksum: MigrationUtils.checksum(tasks),
      errors: errors
    };
  },

  rollbackPlan(manifest, dataSource, appliedOperationIds, baselineTasks) {
    const tasks = dataSource.readSheet(CONFIG.SHEETS.TASKS);
    const errors = [];
    const baselineRows = baselineTasks && Array.isArray(baselineTasks.rows)
      ? baselineTasks.rows : [];
    if (baselineRows.length === 0) {
      errors.push("Baseline Tasks obbligatoria per il rollback.");
    }
    const allowedRows = {};
    if (Array.isArray(appliedOperationIds)) {
      manifest.operations.forEach((operation, index) => {
        if (appliedOperationIds.indexOf(operation.operationId) !== -1) {
          allowedRows[manifest.repairEntries[index].rowNumber] = true;
        }
      });
    }
    const repairEntries = (manifest.repairEntries || []).filter(entry => (
      !Array.isArray(appliedOperationIds) || allowedRows[entry.rowNumber]
    ));
    const operations = repairEntries.slice()
      .sort((left, right) => right.rowNumber - left.rowNumber)
      .map((entry, index) => {
        const row = tasks.rows.find(candidate => (
          Number(candidate.rowNumber) === Number(entry.rowNumber)
        ));
        const baselineRow = baselineRows.find(candidate => (
          Number(candidate.rowNumber) === Number(entry.rowNumber)
        ));
        if (!row || String(row.values.ID) !== entry.newTaskId) {
          errors.push("Stato rollback divergente alla riga " + entry.rowNumber + ".");
          return null;
        }
        if (!baselineRow || String(baselineRow.values.ID || "") !==
            entry.oldTaskId || this.taskContentHash(row.values) !==
            this.taskContentHash(baselineRow.values)) {
          errors.push("Hash rollback divergente alla riga " + entry.rowNumber + ".");
        }
        return {
          rollbackOperationId: "ROLLBACK-TASK-ID-" +
            String(index + 1).padStart(3, "0"),
          sheet: CONFIG.SHEETS.TASKS,
          rowNumber: Number(entry.rowNumber),
          expectedCurrentHash: this.rowHash(row.values),
          currentTaskId: entry.newTaskId,
          restoreTaskId: entry.oldTaskId
        };
      }).filter(Boolean);
    const plan = {
      migrationId: this.MIGRATION_ID,
      readOnly: true,
      executable: false,
      operations: operations,
      errors: errors
    };
    plan.checksum = MigrationUtils.checksum(plan);
    return plan;
  },

  createWriter(spreadsheet, authorization) {
    this.assertExecutionAuthorization(authorization);
    return {
      apply: operation => this.applyRepairOperation(
        spreadsheet, operation, authorization
      ),
      applyRollback: operation => (
        this.applyRollbackOperation(spreadsheet, operation, authorization)
      )
    };
  },

  applyRepairOperation(spreadsheet, operation, authorization) {
    this.assertExecutionAuthorization(authorization);
    const entry = this.FROZEN_REPAIR_ENTRIES.find(candidate => (
      Number(candidate.rowNumber) === Number(operation.selector._rowNumber) &&
      candidate.oldTaskId === operation.selector.ID &&
      candidate.newTaskId === operation.after.ID &&
      candidate.rowHash === operation.expectedRowHash
    ));
    if (!entry || !MigrationUtils.valuesEqual(
      Object.keys(operation.after), ["ID"]
    )) {
      throw new Error("Operazione Task ID Repair non presente nel manifesto.");
    }
    const context = this.readPhysicalRow(spreadsheet, entry.rowNumber);
    if (String(context.values.ID || "").trim() !== entry.oldTaskId ||
        this.rowHash(context.values) !== entry.rowHash) {
      throw new Error("Riga Tasks divergente: " + entry.rowNumber + ".");
    }
    context.sheet.getRange(
      entry.rowNumber, CONFIG.TASK_COLUMNS.ID, 1, 1
    ).setValue(entry.newTaskId);
    const after = MigrationUtils.clone(context.values);
    after.ID = entry.newTaskId;
    return {
      before: MigrationRecordCodec.encode(context.values),
      after: MigrationRecordCodec.encode(after)
    };
  },

  applyRollbackOperation(spreadsheet, operation, authorization) {
    this.assertExecutionAuthorization(authorization);
    const context = this.readPhysicalRow(spreadsheet, operation.rowNumber);
    if (String(context.values.ID || "").trim() !== operation.currentTaskId ||
        this.rowHash(context.values) !== operation.expectedCurrentHash) {
      throw new Error("Riga Tasks divergente per rollback: " +
        operation.rowNumber + ".");
    }
    context.sheet.getRange(
      operation.rowNumber, CONFIG.TASK_COLUMNS.ID, 1, 1
    ).setValue(operation.restoreTaskId);
    return true;
  },

  readPhysicalRow(spreadsheet, rowNumber) {
    const sheet = spreadsheet.getSheetByName(CONFIG.SHEETS.TASKS);
    const headers = sheet.getRange(
      1, 1, 1, sheet.getLastColumn()
    ).getValues()[0].map(value => String(value || ""));
    const row = sheet.getRange(
      Number(rowNumber), 1, 1, headers.length
    ).getValues()[0];
    return {
      sheet: sheet,
      values: headers.reduce((record, header, index) => {
        record[header] = MigrationUtils.normalizeValue(row[index]);
        return record;
      }, {})
    };
  },

  assertExecutionAuthorization(authorization) {
    if (this.CLOSED === true) {
      throw new Error("TASK_ID_REPAIR_V1 è VALIDATED_CLOSED e non rieseguibile.");
    }
    if (!authorization || authorization.approved !== true ||
        authorization.migrationId !== this.MIGRATION_ID ||
        authorization.version !== this.VERSION ||
        authorization.fingerprint !== this.frozenManifest().fingerprint ||
        authorization.tasksChecksum !== this.TASKS_CHECKSUM) {
      throw new Error("Autorizzazione TASK_ID_REPAIR_V1 non valida.");
    }
    return true;
  },

  validateApprovedEntries(entries, diagnosis) {
    const errors = [];
    const expected = this.EXPECTED_DUPLICATE_IDS.slice().sort();
    const actualGroups = diagnosis.duplicates.map(group => group.taskId).sort();
    if (!diagnosis.schemaValid) errors.push("Schema Tasks non valido.");
    if (!MigrationUtils.valuesEqual(actualGroups, expected)) {
      errors.push("I gruppi duplicati non coincidono esattamente con quelli approvati.");
    }
    diagnosis.duplicates.forEach(group => {
      if (group.occurrences !== 2) {
        errors.push(group.taskId + ": occorrenze attese 2, trovate " +
          group.occurrences + ".");
      }
    });
    if (!Array.isArray(entries) || entries.length !== expected.length) {
      errors.push("Sono richieste esattamente tre righe di riparazione.");
      return { pass: false, errors: errors };
    }
    const existingIds = {};
    diagnosis.taskIds.forEach(id => { existingIds[id] = true; });
    const newIds = [];
    entries.forEach(entry => {
      const group = diagnosis.duplicates.find(item => (
        item.taskId === String(entry.oldTaskId)
      ));
      if (!group || group.rows.length !== 2 ||
          Number(entry.rowNumber) !== Number(group.rows[1].rowNumber)) {
        errors.push("La riga di riparazione non è la seconda occorrenza di " +
          String(entry.oldTaskId) + ".");
        return;
      }
      if (String(entry.rowHash) !== group.rows[1].rowHash) {
        errors.push("Hash divergente alla riga " + entry.rowNumber + ".");
      }
      const newId = String(entry.newTaskId || "").trim();
      if (!newId || newId === String(entry.oldTaskId) || existingIds[newId]) {
        errors.push("Nuovo Task ID non valido o già esistente: " + newId + ".");
      }
      if (newId !== this.repairId(entry.oldTaskId, 2)) {
        errors.push("Nuovo Task ID non conforme alla regola deterministica: " +
          newId + ".");
      }
      newIds.push(newId);
    });
    if (this.duplicates(newIds).length > 0) errors.push("Nuovi Task ID duplicati.");
    return { pass: errors.length === 0, errors: errors };
  },

  rowHash(values) {
    return MigrationUtils.checksum(
      MigrationRecordCodec.encode(this.canonicalTaskRecord(values))
    );
  },

  taskContentHash(values) {
    const record = this.canonicalTaskRecord(values);
    delete record.ID;
    return MigrationUtils.checksum(MigrationRecordCodec.encode(record));
  },

  canonicalTaskRecord(values) {
    return TASK_HEADERS.reduce((record, header) => {
      record[header] = MigrationUtils.normalizeValue(values[header]);
      return record;
    }, {});
  },

  schemaValid(actualHeaders) {
    return MigrationDataSource.headersMatchWithEmptyTail(
      actualHeaders, TASK_HEADERS
    );
  },

  repairId(oldTaskId, occurrence) {
    return String(oldTaskId || "").trim() + "-R" +
      String(occurrence).padStart(2, "0");
  },

  report(manifest, preflight, postflight, startedAt, finishedAt, rollbackPlan) {
    return {
      migrationId: this.MIGRATION_ID,
      initialGroups: this.EXPECTED_DUPLICATE_IDS.map(id => ({
        taskId: id, occurrences: 2, retainedTaskId: id,
        newTaskId: this.repairId(id, 2)
      })),
      updatedRows: (manifest.repairEntries || []).map(entry => entry.rowNumber),
      manifestFingerprint: manifest.fingerprint,
      baselineChecksum: manifest.tasksChecksum,
      finalChecksum: postflight ? postflight.checksum : "",
      durationMs: Math.max(0, new Date(finishedAt).getTime() -
        new Date(startedAt).getTime()),
      preflightPassed: !!preflight && preflight.pass === true,
      postflightPassed: !!postflight && postflight.pass === true,
      rollback: {
        prepared: !!rollbackPlan && rollbackPlan.errors.length === 0,
        executable: !!rollbackPlan && rollbackPlan.executable === true,
        operations: rollbackPlan ? rollbackPlan.operations.length : 0,
        checksum: rollbackPlan ? rollbackPlan.checksum : "",
        errors: rollbackPlan ? rollbackPlan.errors : []
      },
      errors: [].concat(preflight ? preflight.errors : [],
        postflight ? postflight.errors : [])
    };
  },

  duplicates(values) {
    const seen = {};
    return values.filter(value => {
      if (seen[value]) return true;
      seen[value] = true;
      return false;
    });
  }
};
