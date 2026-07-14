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
  }

};
