const MigrationPreflightValidator = {

  validate(manifest, backup, dryRun) {
    const prepared = MigrationManifest.prepare(manifest);
    const gates = [];
    const errors = [];

    this.gate(
      gates,
      errors,
      manifest.mode === "EXECUTION_READY",
      "MANIFEST_MODE",
      "Modalità EXECUTION_READY verificata."
    );
    this.gate(
      gates,
      errors,
      !!dryRun && dryRun.success === true && dryRun.dryRun === true,
      "DRY_RUN",
      "Dry run valido."
    );
    this.gate(
      gates,
      errors,
      dryRun.manifestChecksum === prepared.checksum,
      "MANIFEST_CHECKSUM",
      "Checksum manifesto coerente."
    );
    this.gate(
      gates,
      errors,
      dryRun.manifestSignature === prepared.signature,
      "MANIFEST_SIGNATURE",
      "Firma manifesto coerente."
    );
    this.gate(
      gates,
      errors,
      dryRun.backupChecksum === backup.checksum,
      "BASELINE_CHECKSUM",
      "Checksum baseline coerente."
    );

    const scannerOperation = manifest.operations.find(operation => (
      operation.operationId === "V14-CREATE-SCANNER-PROJECT"
    ));
    const scannerDatesValid = !!scannerOperation &&
      scannerOperation.after["Creato il"] instanceof Date &&
      scannerOperation.after["Ultimo aggiornamento"] instanceof Date;
    const generatedScannerId = scannerDatesValid
      ? ProjectService.generateId(scannerOperation.after["Creato il"])
      : "";
    const scannerReferences = manifest.operations
      .filter(operation => (
        operation.operationId.indexOf("V14-MOVE-SCANNER-") === 0
      ))
      .map(operation => (
        operation.after.ProjectID || operation.after["Project ID"]
      ));

    this.gate(
      gates,
      errors,
      scannerDatesValid,
      "SCANNER_DATES",
      "Date native del progetto scanner verificate."
    );
    this.gate(
      gates,
      errors,
      !!scannerOperation &&
        scannerOperation.after.ID === generatedScannerId &&
        scannerOperation.selector.ID === generatedScannerId &&
        scannerReferences.every(id => id === generatedScannerId) &&
        generatedScannerId !== "PRJ-20260714-SCANNER-001",
      "SCANNER_PROJECT_ID",
      "Project ID scanner derivato dal generatore del dominio."
    );

    const completionOperations = manifest.operations.filter(operation => (
      operation.action === "COMPLETE"
    ));
    this.gate(
      gates,
      errors,
      completionOperations.length === 2 &&
        completionOperations.every(operation => (
          operation.after.UpdatedAt instanceof Date &&
          operation.after.CompletedAt instanceof Date
        )),
      "TASK_COMPLETION_DATES",
      "UpdatedAt e CompletedAt nativi verificati."
    );

    const reversible = dryRun.operations.length === manifest.operations.length &&
      dryRun.operations.every(operation => {
        if (!operation.valid) {
          return false;
        }

        if (operation.action === "CREATE") {
          return !!operation.after;
        }

        if (operation.action === "DELETE") {
          return !!operation.before;
        }

        return !!operation.before && !!operation.after;
      });

    this.gate(
      gates,
      errors,
      reversible,
      "REVERSIBILITY",
      "Reversibilità di tutte le operazioni verificata."
    );

    const simulation = this.simulate(manifest, backup);

    this.gate(
      gates,
      errors,
      simulation.valid,
      "FINAL_INTEGRITY",
      simulation.errors.join("; ") || "Integrità finale valida."
    );

    return {
      pass: errors.length === 0,
      status: errors.length === 0 ? "EXECUTION_READY" : "PREFLIGHT_FAILED",
      migrationId: manifest.migrationId,
      generatedProjectId: generatedScannerId,
      checksum: prepared.checksum,
      signature: prepared.signature,
      gates: gates,
      errors: errors,
      finalCounts: simulation.counts
    };
  },

  simulate(manifest, backup) {
    const sheets = MigrationUtils.clone(backup.sheets);
    const errors = [];

    manifest.operations.forEach(operation => {
      const sheet = sheets[operation.sheet];

      if (!sheet) {
        errors.push("Foglio mancante: " + operation.sheet);
        return;
      }

      if (operation.action === "CREATE") {
        const duplicate = sheet.rows.some(row => (
          DryRunEngine.matchesRow(row, operation.selector || {})
        ));

        if (duplicate) {
          errors.push(operation.operationId + ": record già presente.");
          return;
        }

        const values = {};
        sheet.headers.forEach(header => {
          values[header] = operation.after[header] === undefined
            ? ""
            : MigrationUtils.clone(operation.after[header]);
        });
        sheet.rows.push({
          rowNumber: sheet.rows.length + 2,
          values: values
        });
        return;
      }

      const matches = sheet.rows.filter(row => (
        DryRunEngine.matchesRow(row, operation.selector || {})
      ));

      if (matches.length !== 1) {
        errors.push(
          operation.operationId + ": trovati " + matches.length + " record."
        );
        return;
      }

      if (operation.action === "DELETE") {
        sheet.rows = sheet.rows.filter(row => row !== matches[0]);
        sheet.rows.forEach((row, index) => {
          row.rowNumber = index + 2;
        });
        return;
      }

      Object.keys(operation.after || {}).forEach(key => {
        matches[0].values[key] = MigrationUtils.clone(operation.after[key]);
      });
    });

    const projects = sheets.Projects.rows.map(row => row.values);
    const tasks = sheets.Tasks.rows.map(row => row.values);
    const timeline = sheets.Timeline.rows.map(row => row.values);
    const projectIds = projects.map(project => String(project.ID || ""));
    const taskIds = tasks.map(task => String(task.ID || ""));
    const taskKeys = tasks.map(task => (
      String(task.ProjectID || "") + "|" +
        String(task.Title || "").trim().toLowerCase()
    ));

    this.addDuplicates(errors, projectIds, "Project ID duplicato");
    this.addDuplicates(errors, taskIds, "Task ID duplicato");
    this.addDuplicates(errors, taskKeys, "Task duplicata");

    tasks.forEach(task => {
      if (projectIds.indexOf(String(task.ProjectID || "")) === -1) {
        errors.push("Task orfana: " + task.ID);
      }

      if (
        task.Status === CONFIG.TASK_STATUS.COMPLETED &&
        (!task.UpdatedAt || !task.CompletedAt)
      ) {
        errors.push("Timestamp completamento non validi: " + task.ID);
      }
    });

    timeline.forEach((event, index) => {
      if (projectIds.indexOf(String(event["Project ID"] || "")) === -1) {
        errors.push("Timeline orfana alla posizione " + (index + 2));
      }
    });

    const expected = manifest.expectedFinalCounts || {};
    const counts = {
      Projects: projects.length,
      Tasks: tasks.length,
      Timeline: timeline.length,
      Settings: sheets.Settings.rows.length
    };

    Object.keys(expected).forEach(sheetName => {
      if (counts[sheetName] !== expected[sheetName]) {
        errors.push(
          sheetName + ": attesi " + expected[sheetName] +
            ", trovati " + counts[sheetName]
        );
      }
    });

    return {
      valid: errors.length === 0,
      errors: errors,
      counts: counts
    };
  },

  addDuplicates(errors, values, label) {
    const seen = {};
    values.forEach(value => {
      if (seen[value]) {
        errors.push(label + ": " + value);
      }
      seen[value] = true;
    });
  },

  gate(gates, errors, passed, name, message) {
    gates.push({
      name: name,
      status: passed ? "PASS" : "FAIL",
      message: message
    });

    if (!passed) {
      errors.push(name + ": " + message);
    }
  }

};
