/**
 * PROJECT REPOSITORY
 */

const ProjectRepository = {

  sheet() {
    return SpreadsheetApp
      .getActiveSpreadsheet()
      .getSheetByName(CONFIG.SHEETS.PROJECTS);
  },

  append(data) {
    this.sheet().appendRow(data);
  },

  lastRow() {
    return this.sheet().getLastRow();
  },

  list() {

    const values = this.sheet().getDataRange().getValues();

    values.shift();

    return values.map(row => ({
      id: row[CONFIG.PROJECT_COLUMNS.ID - 1],
      name: row[CONFIG.PROJECT_COLUMNS.NAME - 1],
      workspace: WorkspaceSettings.normalize(
        row[CONFIG.PROJECT_COLUMNS.WORKSPACE - 1]
      )
    }));

  },

  listByWorkspace(workspace) {

    const normalizedWorkspace = WorkspaceSettings.normalize(workspace);

    return this.listAll().filter(project => (
      WorkspaceSettings.normalize(project.workspace) === normalizedWorkspace
    ));

  },

  listAll() {

    const values = this.sheet().getDataRange().getValues();

    values.shift();

    return values.map(row => this.fromRow(row));

  },

  getById(id) {

    const values = this.sheet().getDataRange().getValues();

    values.shift();

    for (const row of values) {

      if (String(row[CONFIG.PROJECT_COLUMNS.ID - 1]).trim() === String(id).trim()) {

        return this.fromRow(row);

      }

    }

    return null;

  },

  update(id, data) {

    const sheet = this.sheet();
    const values = sheet.getDataRange().getValues();

    for (let i = 1; i < values.length; i++) {

      const row = values[i];

      if (String(row[CONFIG.PROJECT_COLUMNS.ID - 1]).trim() === String(id).trim()) {

        const rowIndex = i + 1;

        if (data.status !== undefined) {
          sheet
            .getRange(rowIndex, CONFIG.PROJECT_COLUMNS.STATUS)
            .setValue(data.status);
        }

        if (data.workspace !== undefined) {
          sheet
            .getRange(rowIndex, CONFIG.PROJECT_COLUMNS.WORKSPACE)
            .setValue(WorkspaceSettings.normalize(data.workspace));
        }

        sheet
          .getRange(rowIndex, CONFIG.PROJECT_COLUMNS.FOCUS)
          .setValue(data.focus);

        sheet
          .getRange(rowIndex, CONFIG.PROJECT_COLUMNS.NEXT_ACTION)
          .setValue(data.nextAction);

        sheet
          .getRange(rowIndex, CONFIG.PROJECT_COLUMNS.UPDATED_AT)
          .setValue(data.updatedAt);

        return true;

      }

    }

    return false;

  },

  fromRow(row) {

    return {
      id: row[CONFIG.PROJECT_COLUMNS.ID - 1],
      name: row[CONFIG.PROJECT_COLUMNS.NAME - 1],
      status: row[CONFIG.PROJECT_COLUMNS.STATUS - 1],
      focus: row[CONFIG.PROJECT_COLUMNS.FOCUS - 1],
      owner: row[CONFIG.PROJECT_COLUMNS.OWNER - 1],
      nextAction: row[CONFIG.PROJECT_COLUMNS.NEXT_ACTION - 1],
      createdAt: row[CONFIG.PROJECT_COLUMNS.CREATED_AT - 1],
      updatedAt: row[CONFIG.PROJECT_COLUMNS.UPDATED_AT - 1],
      workspace: WorkspaceSettings.normalize(
        row[CONFIG.PROJECT_COLUMNS.WORKSPACE - 1]
      )
    };

  }

};
