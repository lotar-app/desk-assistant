const WorkspaceRepository = {

  sheet() {
    return SpreadsheetApp
      .getActiveSpreadsheet()
      .getSheetByName(CONFIG.SHEETS.WORKSPACES);
  },

  listAll() {
    const sheet = this.sheet();
    if (!sheet || sheet.getLastRow() < 2) {
      return [];
    }
    const values = sheet.getDataRange().getValues();
    values.shift();
    return values.map(row => this.fromRow(row));
  },

  getById(id) {
    const normalizedId = WorkspaceSettings.normalize(id);
    return this.listAll().find(workspace => workspace.id === normalizedId) || null;
  },

  append(workspace) {
    this.sheet().appendRow([
      workspace.id,
      workspace.name,
      workspace.isDefault,
      workspace.status,
      workspace.createdAt,
      workspace.updatedAt
    ]);
  },

  update(id, changes) {
    const sheet = this.sheet();
    const values = sheet.getDataRange().getValues();
    const normalizedId = WorkspaceSettings.normalize(id);

    for (let index = 1; index < values.length; index++) {
      if (WorkspaceSettings.normalize(values[index][0]) !== normalizedId) {
        continue;
      }
      const current = this.fromRow(values[index]);
      const updated = Object.assign({}, current, changes || {});
      sheet.getRange(index + 1, 1, 1, WORKSPACE_HEADERS.length).setValues([[
        current.id,
        updated.name,
        updated.isDefault,
        updated.status,
        current.createdAt,
        updated.updatedAt
      ]]);
      return this.getById(current.id);
    }
    return null;
  },

  fromRow(row) {
    return {
      id: WorkspaceSettings.normalize(row[CONFIG.WORKSPACE_COLUMNS.ID - 1]),
      name: String(row[CONFIG.WORKSPACE_COLUMNS.NAME - 1] || "").trim(),
      isDefault: workspaceBoolean(row[CONFIG.WORKSPACE_COLUMNS.IS_DEFAULT - 1]),
      status: String(row[CONFIG.WORKSPACE_COLUMNS.STATUS - 1] || "").trim(),
      createdAt: row[CONFIG.WORKSPACE_COLUMNS.CREATED_AT - 1],
      updatedAt: row[CONFIG.WORKSPACE_COLUMNS.UPDATED_AT - 1]
    };
  }
};

function workspaceBoolean(value) {
  return value === true || String(value || "").trim().toLowerCase() === "true";
}
