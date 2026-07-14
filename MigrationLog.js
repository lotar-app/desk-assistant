const MigrationLog = {

  create(migrationId) {
    return {
      migrationId: migrationId,
      createdAt: new Date().toISOString(),
      readOnly: true,
      entries: []
    };
  },

  append(log, entry) {
    if (!log || !Array.isArray(log.entries)) {
      throw new Error("Migration log non valido.");
    }

    const normalized = MigrationUtils.clone(entry);
    normalized.sequence = log.entries.length + 1;
    normalized.recordedAt = new Date().toISOString();
    log.entries.push(normalized);
    return normalized;
  },

  seal(log) {
    const sealed = MigrationUtils.clone(log);
    sealed.checksum = MigrationUtils.checksum({
      migrationId: sealed.migrationId,
      entries: sealed.entries
    });
    return sealed;
  }

};
