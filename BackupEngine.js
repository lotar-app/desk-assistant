const BackupEngine = {

  create(dataSource, manifest) {
    MigrationManifest.validate(manifest);

    if (!dataSource || typeof dataSource.readSheet !== "function") {
      throw new Error("Data source di backup non valido.");
    }

    const sheetNames = Object.keys(manifest.baseline.sheets || {});
    const sheets = {};

    sheetNames.forEach(sheetName => {
      sheets[sheetName] = dataSource.readSheet(sheetName);
    });

    const backup = {
      migrationId: manifest.migrationId,
      createdAt: new Date().toISOString(),
      readOnly: true,
      sheets: sheets
    };

    backup.checksum = MigrationUtils.checksum({
      migrationId: backup.migrationId,
      sheets: backup.sheets
    });

    return backup;
  },

  createPhysical(backup, manifest, options) {
    options = options || {};
    MigrationManifest.validate(manifest);
    const services = options.services || this.defaultServices();
    const spreadsheet = services.getActiveSpreadsheet();
    const sourceFile = services.getFileById(spreadsheet.getId());
    const folder = options.folderId
      ? services.getFolderById(options.folderId)
      : services.getParentFolder(sourceFile);
    const timestamp = Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      "yyyyMMdd-HHmmss"
    );
    const baseName = spreadsheet.getName() + "-" +
      backup.migrationId + "-" + timestamp;
    const copyFile = services.makeCopy(
      sourceFile,
      baseName + "-backup",
      folder
    );
    const copiedSpreadsheet = services.openSpreadsheetById(copyFile.getId());
    const copiedBackup = this.create(
      MigrationDataSource.forSpreadsheet(copiedSpreadsheet),
      manifest
    );
    const copyVerified = copiedBackup.checksum === backup.checksum;
    const xlsxBlob = services.exportXlsx(
      spreadsheet.getId(),
      baseName + ".xlsx"
    );
    const xlsxFile = services.createFile(folder, xlsxBlob);
    const xlsxVerified = xlsxFile.getSize() > 0;
    const result = {
      migrationId: backup.migrationId,
      createdAt: new Date().toISOString(),
      sourceSpreadsheetId: spreadsheet.getId(),
      sourceChecksum: backup.checksum,
      spreadsheetCopyId: copyFile.getId(),
      spreadsheetCopyChecksum: copiedBackup.checksum,
      xlsxFileId: xlsxFile.getId(),
      xlsxSize: xlsxFile.getSize(),
      copyVerified: copyVerified,
      xlsxVerified: xlsxVerified,
      verified: copyVerified && xlsxVerified
    };

    result.checksum = MigrationUtils.checksum(result);

    if (!result.verified) {
      throw new Error("Backup fisico creato ma non verificato.");
    }

    return result;
  },

  defaultServices() {
    return {
      getActiveSpreadsheet() {
        return SpreadsheetApp.getActiveSpreadsheet();
      },
      getFileById(id) {
        return DriveApp.getFileById(id);
      },
      getFolderById(id) {
        return DriveApp.getFolderById(id);
      },
      getParentFolder(file) {
        const parents = file.getParents();
        return parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
      },
      makeCopy(file, name, folder) {
        return file.makeCopy(name, folder);
      },
      openSpreadsheetById(id) {
        return SpreadsheetApp.openById(id);
      },
      exportXlsx(spreadsheetId, fileName) {
        const response = UrlFetchApp.fetch(
          "https://docs.google.com/spreadsheets/d/" + spreadsheetId +
            "/export?format=xlsx",
          {
            headers: {
              Authorization: "Bearer " + ScriptApp.getOAuthToken()
            },
            muteHttpExceptions: true
          }
        );

        if (response.getResponseCode() !== 200) {
          throw new Error(
            "Esportazione XLSX non riuscita: HTTP " +
              response.getResponseCode()
          );
        }

        return response.getBlob().setName(fileName);
      },
      createFile(folder, blob) {
        return folder.createFile(blob);
      }
    };
  }

};
