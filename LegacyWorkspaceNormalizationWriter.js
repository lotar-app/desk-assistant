const LegacyWorkspaceNormalizationWriter = {

  create(spreadsheet) {
    return {
      apply(operation, manifest) {
        return LegacyWorkspaceNormalizationWriter.apply(
          spreadsheet, operation, manifest
        );
      },
      rollback(operation, manifest) {
        return LegacyWorkspaceNormalizationWriter.rollback(
          spreadsheet, operation, manifest
        );
      }
    };
  },

  assertOperation(operation) {
    if (!operation ||
        operation.operationId !== "LWN-001-NORMALIZE-PROJECTS" ||
        operation.action !== "NORMALIZE_LEGACY_WORKSPACE_COLUMN" ||
        operation.sheet !== CONFIG.SHEETS.PROJECTS ||
        Number(operation.column) !== 9) {
      throw new Error("Operazione normalizzazione non autorizzata.");
    }
  },

  apply(spreadsheet, operation, manifest) {
    this.assertOperation(operation);
    const dataSource = LegacyWorkspaceNormalization.forSpreadsheet(spreadsheet);
    const preflight = LegacyWorkspaceNormalization.preflight(dataSource);
    if (!preflight.pass ||
        preflight.fingerprint !== manifest.fingerprint ||
        preflight.projectsChecksum !== manifest.baselineState.projectsChecksum) {
      throw new Error("Baseline divergente immediatamente prima della scrittura.");
    }
    const sheet = spreadsheet.getSheetByName(CONFIG.SHEETS.PROJECTS);
    sheet.deleteColumn(9);
    return {
      operationId: operation.operationId,
      action: operation.action,
      sheet: operation.sheet,
      before: MigrationUtils.clone(manifest.legacyAssignments),
      after: { headers: LegacyWorkspaceNormalization.FINAL_HEADERS.slice() }
    };
  },

  rollback(spreadsheet, operation, manifest) {
    this.assertOperation(operation);
    const dataSource = LegacyWorkspaceNormalization.forSpreadsheet(spreadsheet);
    const projects = dataSource.readSheet(CONFIG.SHEETS.PROJECTS);
    if (!MigrationUtils.valuesEqual(
      projects.headers, LegacyWorkspaceNormalization.FINAL_HEADERS
    )) {
      throw new Error("Stato normalizzato non valido per il rollback.");
    }
    if (dataSource.readSheet(CONFIG.SHEETS.WORKSPACES).exists ||
        dataSource.readSheet(CONFIG.SHEETS.WORKSPACE_ALIASES).exists) {
      throw new Error("Rollback rifiutato: Workspace Foundation presente.");
    }
    const currentById = {};
    projects.rows.forEach(row => { currentById[String(row.values.ID || "")] = row; });
    manifest.legacyAssignments.forEach(item => {
      const current = currentById[item.projectId];
      if (!current || current.rowNumber !== item.rowNumber) {
        throw new Error("Righe Projects divergenti per il rollback.");
      }
    });
    const sheet = spreadsheet.getSheetByName(CONFIG.SHEETS.PROJECTS);
    sheet.insertColumnAfter(8);
    sheet.getRange(1, 9, 1, 1).setValues([[""]]);
    manifest.legacyAssignments.forEach(item => {
      sheet.getRange(item.rowNumber, 9, 1, 1)
        .setValues([[item.legacyWorkspace]]);
    });
    const restored = LegacyWorkspaceNormalization.preflight(
      LegacyWorkspaceNormalization.forSpreadsheet(spreadsheet)
    );
    if (!restored.pass ||
        restored.projectsChecksum !== manifest.baselineState.projectsChecksum) {
      throw new Error("Rollback normalizzazione non verificato.");
    }
    return { operationId: operation.operationId, action: "ROLLBACK", restored: true,
      projectsChecksum: restored.projectsChecksum };
  }
};
