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

    const operations = preparedManifest.operations.map(operation => (
      this.inspectOperation(operation, backup, log)
    ));
    const success = operations.every(operation => operation.valid);

    return {
      success: success,
      dryRun: true,
      manifestChecksum: preparedManifest.checksum,
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

    MigrationLog.append(log, {
      operationId: operation.operationId,
      action: operation.action,
      sheet: operation.sheet,
      status: valid ? "PLANNED" : "REJECTED",
      before: result.before || null,
      after: result.after || null,
      message: result.reason
    });

    return result;
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
