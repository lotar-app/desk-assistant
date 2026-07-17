const WorkspaceAliasRepository = {

  sheet() {
    return SpreadsheetApp
      .getActiveSpreadsheet()
      .getSheetByName(CONFIG.SHEETS.WORKSPACE_ALIASES);
  },

  listAll() {
    const sheet = this.sheet();
    if (!sheet || sheet.getLastRow() < 2) {
      return [];
    }
    const values = sheet.getDataRange().getValues();
    values.shift();
    return values.map(row => ({
      alias: String(row[CONFIG.WORKSPACE_ALIAS_COLUMNS.ALIAS - 1] || "").trim(),
      workspaceId: WorkspaceSettings.normalize(
        row[CONFIG.WORKSPACE_ALIAS_COLUMNS.WORKSPACE_ID - 1]
      ),
      createdAt: row[CONFIG.WORKSPACE_ALIAS_COLUMNS.CREATED_AT - 1]
    }));
  },

  append(alias) {
    this.sheet().appendRow([alias.alias, alias.workspaceId, alias.createdAt]);
  },

  move(sourceWorkspaceId, targetWorkspaceId) {
    const sheet = this.sheet();
    if (!sheet || sheet.getLastRow() < 2) {
      return;
    }
    const source = WorkspaceSettings.normalize(sourceWorkspaceId);
    const values = sheet.getDataRange().getValues();
    for (let index = 1; index < values.length; index++) {
      if (WorkspaceSettings.normalize(values[index][1]) === source) {
        sheet.getRange(index + 1, CONFIG.WORKSPACE_ALIAS_COLUMNS.WORKSPACE_ID)
          .setValue(WorkspaceSettings.normalize(targetWorkspaceId));
      }
    }
  }
};
