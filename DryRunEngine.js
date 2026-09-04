const DryRunEngine = {

  run(manifest, backup) {
    const preparedManifest = MigrationManifest.prepare(manifest);
    const baseline = BaselineValidator.validate(backup, preparedManifest);
    const log = MigrationLog.create(preparedManifest.migrationId);

    if (!baseline.valid) {
      return {
        success: false,
        dryRun: true,
        baseline: baseline,
        operations: [],
        log: MigrationLog.seal(log)
      };
    }

    const virtualBackup = MigrationUtils.clone(backup);
    const operations = preparedManifest.operations.map(operation => (
      this.inspectOperation(operation, virtualBackup, log)
    ));
    const success = operations.every(operation => operation.valid);

    return {
      success: success,
      dryRun: true,
      manifestChecksum: preparedManifest.checksum,
      manifestSignature: preparedManifest.signature,
      backupChecksum: backup.checksum,
      baseline: baseline,
      operations: operations,
      summary: operations.reduce((summary, operation) => {
        summary.total++;
        summary[operation.valid ? "valid" : "invalid"]++;
        return summary;
      }, { total: 0, valid: 0, invalid: 0 }),
      log: MigrationLog.seal(log)
    };
  },

  inspectOperation(operation, backup, log) {
    const sheet = backup.sheets[operation.sheet];
    if (operation.action === "CREATE_SHEET") {
      const headers = operation.after && operation.after.headers;
      const valid = (!sheet || sheet.exists === false) &&
        Array.isArray(headers) && headers.length > 0;
      const result = this.structuralResult(operation, valid,
        valid ? "Foglio assente e creabile." : "Foglio già presente o header mancanti.");
      if (valid) {
        backup.sheets[operation.sheet] = {
          name: operation.sheet, exists: true,
          headers: MigrationUtils.clone(headers), rows: []
        };
      }
      this.appendResult(log, result);
      return result;
    }

    if (operation.action === "ADD_COLUMN") {
      const after = operation.after || {};
      const valid = !!sheet && sheet.exists !== false &&
        sheet.headers.indexOf(after.header) === -1 &&
        Number(after.position) === sheet.headers.length + 1;
      const result = this.structuralResult(operation, valid,
        valid ? "Colonna assente e aggiungibile in coda." :
          "Foglio, header o posizione della colonna non compatibili.");
      if (valid) {
        result.before = { headers: MigrationUtils.clone(sheet.headers) };
        sheet.headers.push(after.header);
        sheet.rows.forEach(row => { row.values[after.header] = ""; });
      }
      this.appendResult(log, result);
      return result;
    }

    const matches = sheet
      ? sheet.rows.filter(row => (
        this.matchesRow(row, operation.selector || {})
      ))
      : [];
    const expectedMatches = operation.action === "CREATE" ? 0 : 1;
    const valid = !!sheet && matches.length === expectedMatches;
    const result = {
      operationId: operation.operationId,
      action: operation.action,
      sheet: operation.sheet,
      selector: MigrationUtils.clone(operation.selector || {}),
      matchedRows: matches.map(row => row.rowNumber),
      expectedMatches: expectedMatches,
      valid: valid,
      reason: valid
        ? "Precondizioni soddisfatte."
        : "Precondizioni non soddisfatte: trovati " + matches.length +
          " record, attesi " + expectedMatches + "."
    };

    if (valid && matches.length === 1) {
      result.before = MigrationUtils.clone(matches[0].values);
    }

    if (valid && operation.after) {
      result.after = MigrationUtils.clone(operation.after);
    }

    if (valid) {
      if (operation.action === "CREATE") {
        const values = {};
        sheet.headers.forEach(header => {
          values[header] = operation.after[header] === undefined
            ? "" : MigrationUtils.clone(operation.after[header]);
        });
        sheet.rows.push({ rowNumber: sheet.rows.length + 2, values: values });
      } else if (operation.action === "DELETE") {
        sheet.rows = sheet.rows.filter(row => row !== matches[0]);
      } else {
        Object.keys(operation.after || {}).forEach(key => {
          matches[0].values[key] = MigrationUtils.clone(operation.after[key]);
        });
      }
    }

    this.appendResult(log, result);

    return result;
  },

  structuralResult(operation, valid, reason) {
    return {
      operationId: operation.operationId,
      action: operation.action,
      sheet: operation.sheet,
      selector: {},
      matchedRows: [],
      expectedMatches: 0,
      valid: valid,
      reason: reason,
      after: valid ? MigrationUtils.clone(operation.after) : null
    };
  },

  appendResult(log, result) {
    MigrationLog.append(log, {
      operationId: result.operationId,
      action: result.action,
      sheet: result.sheet,
      status: result.valid ? "PLANNED" : "REJECTED",
      before: result.before || null,
      after: result.after || null,
      message: result.reason
    });
  },

  matchesRow(row, selector) {
    const valueSelector = {};

    Object.keys(selector || {}).forEach(key => {
      if (key !== "_rowNumber") {
        valueSelector[key] = selector[key];
      }
    });

    return (
      (selector._rowNumber === undefined ||
        Number(selector._rowNumber) === Number(row.rowNumber)) &&
      MigrationUtils.matches(row.values, valueSelector)
    );
  }

};
