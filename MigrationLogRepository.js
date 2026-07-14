const MigrationLogRepository = {

  create(spreadsheet) {
    return {
      ensureSheet() {
        let sheet = spreadsheet.getSheetByName(CONFIG.SHEETS.MIGRATION_LOG);

        if (!sheet) {
          sheet = spreadsheet.insertSheet(CONFIG.SHEETS.MIGRATION_LOG);
        }

        if (sheet.getLastRow() === 0) {
          sheet.appendRow(MIGRATION_LOG_HEADERS);
        } else {
          const headers = sheet
            .getRange(1, 1, 1, MIGRATION_LOG_HEADERS.length)
            .getValues()[0]
            .map(String);

          if (!MigrationUtils.valuesEqual(headers, MIGRATION_LOG_HEADERS)) {
            throw new Error("Header MigrationLog non validi.");
          }
        }

        return sheet;
      },

      append(entry) {
        const sheet = this.ensureSheet();
        const expectedSequence = this.nextSequence(entry.migrationId);

        if (Number(entry.sequence) !== expectedSequence) {
          throw new Error(
            "Sequenza MigrationLog non valida: attesa " +
              expectedSequence + ", ricevuta " + entry.sequence
          );
        }

        const recordedAt = entry.recordedAt || new Date().toISOString();
        const payload = {
          migrationId: entry.migrationId,
          sequence: entry.sequence,
          operationId: entry.operationId,
          action: entry.action,
          sheet: entry.sheet,
          status: entry.status,
          before: entry.before || null,
          after: entry.after || null,
          message: entry.message || "",
          recordedAt: recordedAt
        };
        const checksum = MigrationUtils.checksum(payload);

        sheet.appendRow([
          payload.migrationId,
          payload.sequence,
          payload.operationId,
          payload.action,
          payload.sheet,
          payload.status,
          JSON.stringify(payload.before),
          JSON.stringify(payload.after),
          payload.message,
          payload.recordedAt,
          checksum
        ]);

        payload.entryChecksum = checksum;
        return payload;
      },

      read(migrationId) {
        const sheet = spreadsheet.getSheetByName(CONFIG.SHEETS.MIGRATION_LOG);

        if (!sheet || sheet.getLastRow() < 2) {
          return {
            migrationId: migrationId,
            entries: [],
            valid: true,
            errors: []
          };
        }

        const values = sheet.getDataRange().getValues();
        const headers = values.shift().map(String);

        if (!MigrationUtils.valuesEqual(headers, MIGRATION_LOG_HEADERS)) {
          return {
            migrationId: migrationId,
            entries: [],
            valid: false,
            errors: ["Header MigrationLog non validi."]
          };
        }

        const indexes = {};
        headers.forEach((header, index) => {
          indexes[header] = index;
        });
        const errors = [];
        const entries = values
          .filter(row => String(row[indexes.MigrationID]) === String(migrationId))
          .map(row => {
            const entry = {
              migrationId: row[indexes.MigrationID],
              sequence: Number(row[indexes.Sequence]),
              operationId: row[indexes.OperationID],
              action: row[indexes.Action],
              sheet: row[indexes.Sheet],
              status: row[indexes.Status],
              before: this.parseJson(row[indexes.Before]),
              after: this.parseJson(row[indexes.After]),
              message: row[indexes.Message] || "",
              recordedAt: MigrationUtils.normalizeValue(row[indexes.RecordedAt])
            };
            const storedChecksum = String(row[indexes.EntryChecksum] || "");
            const actualChecksum = MigrationUtils.checksum(entry);

            entry.entryChecksum = storedChecksum;

            if (storedChecksum !== actualChecksum) {
              errors.push(
                "Checksum MigrationLog non valido per " + entry.operationId +
                  " sequenza " + entry.sequence
              );
            }

            return entry;
          })
          .sort((left, right) => left.sequence - right.sequence);

        entries.forEach((entry, index) => {
          if (entry.sequence !== index + 1) {
            errors.push(
              "Sequenza MigrationLog non continua alla posizione " +
                (index + 1)
            );
          }
        });

        return {
          migrationId: migrationId,
          entries: entries,
          valid: errors.length === 0,
          errors: errors
        };
      },

      nextSequence(migrationId) {
        const log = this.read(migrationId);

        if (!log.valid) {
          throw new Error(log.errors.join("; "));
        }

        return log.entries.reduce((max, entry) => (
          Math.max(max, Number(entry.sequence) || 0)
        ), 0) + 1;
      },

      parseJson(value) {
        const text = String(value || "");
        return text ? JSON.parse(text) : null;
      }
    };
  }

};
