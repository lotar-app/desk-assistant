const BaselineValidator = {

  validate(backup, manifest) {
    MigrationManifest.validate(manifest);

    const errors = [];
    const checks = [];
    const sheetBaselines = manifest.baseline.sheets || {};

    Object.keys(sheetBaselines).forEach(sheetName => {
      const expected = sheetBaselines[sheetName];
      const actual = backup.sheets[sheetName];

      if (!actual) {
        errors.push("Foglio mancante nel backup: " + sheetName);
        return;
      }

      this.check(
        checks,
        errors,
        actual.rows.length === expected.recordCount,
        sheetName + ": record attesi " + expected.recordCount +
          ", trovati " + actual.rows.length
      );

      (expected.requiredHeaders || []).forEach(header => {
        this.check(
          checks,
          errors,
          actual.headers.indexOf(header) !== -1,
          sheetName + ": header mancante " + header
        );
      });

      if (expected.idField && expected.ids) {
        const actualIds = actual.rows
          .map(row => String(row.values[expected.idField] || ""))
          .sort();
        const expectedIds = expected.ids.map(String).sort();

        this.check(
          checks,
          errors,
          MigrationUtils.valuesEqual(actualIds, expectedIds),
          sheetName + ": insieme identificativi divergente"
        );
      }

      (expected.assertions || []).forEach((assertion, index) => {
        const matches = actual.rows.filter(row => (
          MigrationUtils.matches(row.values, assertion.selector)
        ));

        this.check(
          checks,
          errors,
          matches.length === assertion.expectedMatches,
          sheetName + ": assertion " + (index + 1) +
            " attende " + assertion.expectedMatches +
            " record, trovati " + matches.length
        );
      });
    });

    return {
      valid: errors.length === 0,
      checkedAt: new Date().toISOString(),
      backupChecksum: backup.checksum,
      checks: checks,
      errors: errors
    };
  },

  check(checks, errors, passed, message) {
    checks.push({
      passed: passed,
      message: message
    });

    if (!passed) {
      errors.push(message);
    }
  }

};
