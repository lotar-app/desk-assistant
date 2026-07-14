const RollbackEngine = {

  buildPlan(migrationLog) {
    if (!migrationLog || !Array.isArray(migrationLog.entries)) {
      throw new Error("Migration log non valido per il rollback.");
    }

    const applied = migrationLog.entries
      .filter(entry => entry.status === "APPLIED")
      .slice()
      .reverse();

    const operations = applied.map(entry => ({
      rollbackOperationId: "ROLLBACK-" + entry.operationId,
      sourceOperationId: entry.operationId,
      sheet: entry.sheet,
      action: this.inverseAction(entry.action),
      restore: MigrationUtils.clone(entry.before),
      expectedCurrent: MigrationUtils.clone(entry.after)
    }));

    const plan = {
      migrationId: migrationLog.migrationId,
      createdAt: new Date().toISOString(),
      readOnly: true,
      executable: false,
      operations: operations
    };

    plan.checksum = MigrationUtils.checksum(plan);
    return plan;
  },

  inverseAction(action) {
    const inverse = {
      CREATE: "DELETE",
      DELETE: "RESTORE",
      UPDATE: "RESTORE",
      MOVE: "RESTORE",
      COMPLETE: "RESTORE"
    }[action];

    if (!inverse) {
      throw new Error("Azione non invertibile: " + action);
    }

    return inverse;
  }

};
