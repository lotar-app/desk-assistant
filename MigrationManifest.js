const MigrationManifest = {

  validate(manifest) {
    if (!manifest || typeof manifest !== "object") {
      throw new Error("Manifesto di migrazione non valido.");
    }

    ["migrationId", "version", "baseline", "operations"].forEach(field => {
      if (!manifest[field]) {
        throw new Error("Campo manifesto mancante: " + field);
      }
    });

    if (!Array.isArray(manifest.operations)) {
      throw new Error("Le operazioni del manifesto devono essere un array.");
    }

    const operationIds = {};

    manifest.operations.forEach(operation => {
      ["operationId", "action", "sheet"].forEach(field => {
        if (!operation[field]) {
          throw new Error(
            "Campo operazione mancante: " + field
          );
        }
      });

      if (operationIds[operation.operationId]) {
        throw new Error(
          "Operation ID duplicato: " + operation.operationId
        );
      }

      operationIds[operation.operationId] = true;
    });

    return true;
  },

  prepare(manifest) {
    this.validate(manifest);
    const prepared = MigrationUtils.clone(manifest);
    prepared.checksum = MigrationUtils.checksum(prepared);
    return prepared;
  }

};
