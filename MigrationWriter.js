const MigrationWriter = {

  create(spreadsheet) {
    return {
      apply(operation) {
        return MigrationWriter.apply(spreadsheet, operation);
      },
      applyRollback(operation) {
        return MigrationWriter.applyRollback(spreadsheet, operation);
      }
    };
  },

  apply(spreadsheet, operation) {
    const context = this.sheetContext(spreadsheet, operation.sheet);

    if (operation.action === "CREATE") {
      const existing = this.findMatches(context, operation.selector || {});

      if (existing.length !== 0) {
        throw new Error(
          operation.operationId + ": il record da creare esiste già."
        );
      }

      const created = this.rowFromRecord(
        context.headers,
        MigrationRecordCodec.decode(operation.after || {})
      );
      context.sheet.appendRow(created);

      return {
        before: null,
        after: MigrationRecordCodec.encode(
          this.recordFromRow(context.headers, created)
        )
      };
    }

    const matches = this.findMatches(context, operation.selector || {});

    if (matches.length !== 1) {
      throw new Error(
        operation.operationId + ": trovati " + matches.length +
          " record, atteso 1."
      );
    }

    const match = matches[0];
    const before = MigrationRecordCodec.encode(match.record);

    if (operation.action === "DELETE") {
      context.sheet.deleteRow(match.rowNumber);
      return { before: before, after: null };
    }

    if (
      operation.action !== "UPDATE" &&
      operation.action !== "MOVE" &&
      operation.action !== "COMPLETE"
    ) {
      throw new Error("Azione writer non supportata: " + operation.action);
    }

    const updated = this.mergeRecord(
      match.record,
      MigrationRecordCodec.decode(operation.after || {})
    );
    const updatedRow = this.rowFromRecord(context.headers, updated);
    context.sheet
      .getRange(match.rowNumber, 1, 1, context.headers.length)
      .setValues([updatedRow]);

    return {
      before: before,
      after: MigrationRecordCodec.encode(updated)
    };
  },

  applyRollback(spreadsheet, operation) {
    const context = this.sheetContext(spreadsheet, operation.sheet);
    const restore = MigrationRecordCodec.decode(operation.restore);
    const expectedCurrent = MigrationRecordCodec.decode(
      operation.expectedCurrent
    );

    if (operation.action === "DELETE") {
      const matches = this.findMatches(context, expectedCurrent || {});

      if (matches.length !== 1) {
        throw new Error(
          operation.rollbackOperationId +
            ": stato corrente divergente per rollback DELETE."
        );
      }

      context.sheet.deleteRow(matches[0].rowNumber);
      return {
        before: MigrationRecordCodec.encode(matches[0].record),
        after: null
      };
    }

    if (operation.action !== "RESTORE") {
      throw new Error(
        "Azione rollback non supportata: " + operation.action
      );
    }

    if (!expectedCurrent) {
      this.assertIdentityAbsent(context, restore);
      const restoredRow = this.rowFromRecord(context.headers, restore);
      context.sheet.appendRow(restoredRow);
      return {
        before: null,
        after: MigrationRecordCodec.encode(restore)
      };
    }

    const matches = this.findMatches(context, expectedCurrent);

    if (matches.length !== 1) {
      throw new Error(
        operation.rollbackOperationId +
          ": stato corrente divergente per rollback RESTORE."
      );
    }

    context.sheet
      .getRange(matches[0].rowNumber, 1, 1, context.headers.length)
      .setValues([this.rowFromRecord(context.headers, restore)]);

    return {
      before: MigrationRecordCodec.encode(matches[0].record),
      after: MigrationRecordCodec.encode(restore)
    };
  },

  sheetContext(spreadsheet, sheetName) {
    const sheet = spreadsheet.getSheetByName(sheetName);

    if (!sheet || sheet.getLastRow() === 0) {
      throw new Error("Foglio non disponibile per la migrazione: " + sheetName);
    }

    const lastColumn = sheet.getLastColumn();
    const headers = sheet
      .getRange(1, 1, 1, lastColumn)
      .getValues()[0]
      .map(value => String(value || ""));

    return {
      sheet: sheet,
      headers: headers
    };
  },

  findMatches(context, selector) {
    if (context.sheet.getLastRow() < 2) {
      return [];
    }

    const rows = context.sheet
      .getRange(
        2,
        1,
        context.sheet.getLastRow() - 1,
        context.headers.length
      )
      .getValues();
    const valueSelector = {};

    Object.keys(selector || {}).forEach(key => {
      if (key !== "_rowNumber") {
        valueSelector[key] = selector[key];
      }
    });

    return rows.map((row, index) => ({
      rowNumber: index + 2,
      record: this.recordFromRow(context.headers, row)
    })).filter(candidate => (
      (selector._rowNumber === undefined ||
        Number(selector._rowNumber) === candidate.rowNumber) &&
      MigrationUtils.matches(candidate.record, valueSelector)
    ));
  },

  assertIdentityAbsent(context, record) {
    const identityField = context.headers.indexOf("ID") !== -1
      ? "ID"
      : null;

    if (
      identityField &&
      this.findMatches(context, { ID: record.ID }).length > 0
    ) {
      throw new Error("Impossibile ripristinare: ID già presente " + record.ID);
    }

    if (!identityField && this.findMatches(context, record).length > 0) {
      throw new Error(
        "Impossibile ripristinare: record equivalente già presente."
      );
    }
  },

  recordFromRow(headers, row) {
    return headers.reduce((record, header, index) => {
      record[header] = row[index] === undefined ? "" : row[index];
      return record;
    }, {});
  },

  rowFromRecord(headers, record) {
    return headers.map(header => (
      record[header] === undefined ? "" : record[header]
    ));
  },

  mergeRecord(record, changes) {
    const merged = {};
    Object.keys(record).forEach(key => {
      merged[key] = record[key];
    });
    Object.keys(changes || {}).forEach(key => {
      if (!Object.prototype.hasOwnProperty.call(record, key)) {
        throw new Error("Campo non presente nel foglio: " + key);
      }
      merged[key] = changes[key];
    });
    return merged;
  }

};
