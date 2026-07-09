/**
 * TASK REPOSITORY
 */

const TaskRepository = {

  sheet() {
    return SpreadsheetApp
      .getActiveSpreadsheet()
      .getSheetByName(CONFIG.SHEETS.TASKS);
  },

  append(data) {
    if (this.sheet().getLastRow() === 0) {
      this.sheet().appendRow(TASK_HEADERS);
    }

    this.sheet().appendRow(data);
  },

  update(id, data) {

    const sheet = this.sheet();
    const values = sheet.getDataRange().getValues();

    for (let i = 1; i < values.length; i++) {

      const row = values[i];

      if (String(row[CONFIG.TASK_COLUMNS.ID - 1]).trim() === String(id).trim()) {

        const rowIndex = i + 1;

        if (data.title !== undefined) {
          sheet
            .getRange(rowIndex, CONFIG.TASK_COLUMNS.TITLE)
            .setValue(data.title);
        }

        if (data.description !== undefined) {
          sheet
            .getRange(rowIndex, CONFIG.TASK_COLUMNS.DESCRIPTION)
            .setValue(data.description);
        }

        if (data.status !== undefined) {
          sheet
            .getRange(rowIndex, CONFIG.TASK_COLUMNS.STATUS)
            .setValue(data.status);
        }

        if (data.priority !== undefined) {
          sheet
            .getRange(rowIndex, CONFIG.TASK_COLUMNS.PRIORITY)
            .setValue(data.priority);
        }

        if (data.assignee !== undefined) {
          sheet
            .getRange(rowIndex, CONFIG.TASK_COLUMNS.ASSIGNEE)
            .setValue(data.assignee);
        }

        if (data.dueDate !== undefined) {
          sheet
            .getRange(rowIndex, CONFIG.TASK_COLUMNS.DUE_DATE)
            .setValue(data.dueDate);
        }

        if (data.updatedAt !== undefined) {
          sheet
            .getRange(rowIndex, CONFIG.TASK_COLUMNS.UPDATED_AT)
            .setValue(data.updatedAt);
        }

        if (data.completedAt !== undefined) {
          sheet
            .getRange(rowIndex, CONFIG.TASK_COLUMNS.COMPLETED_AT)
            .setValue(data.completedAt);
        }

        return true;

      }

    }

    return false;

  },

  list() {

    const values = this.sheet().getDataRange().getValues();

    values.shift();

    return values.map(row => this.fromRow(row));

  },

  listByProject(projectId) {

    return this
      .list()
      .filter(task => String(task.projectId).trim() === String(projectId).trim());

  },

  getById(id) {

    const values = this.sheet().getDataRange().getValues();

    values.shift();

    for (const row of values) {

      if (String(row[CONFIG.TASK_COLUMNS.ID - 1]).trim() === String(id).trim()) {
        return this.fromRow(row);
      }

    }

    return null;

  },

  fromRow(row) {

    return {
      id: row[CONFIG.TASK_COLUMNS.ID - 1],
      projectId: row[CONFIG.TASK_COLUMNS.PROJECT_ID - 1],
      title: row[CONFIG.TASK_COLUMNS.TITLE - 1],
      description: row[CONFIG.TASK_COLUMNS.DESCRIPTION - 1],
      status: row[CONFIG.TASK_COLUMNS.STATUS - 1],
      priority: row[CONFIG.TASK_COLUMNS.PRIORITY - 1],
      assignee: row[CONFIG.TASK_COLUMNS.ASSIGNEE - 1],
      dueDate: row[CONFIG.TASK_COLUMNS.DUE_DATE - 1],
      createdAt: row[CONFIG.TASK_COLUMNS.CREATED_AT - 1],
      updatedAt: row[CONFIG.TASK_COLUMNS.UPDATED_AT - 1],
      completedAt: row[CONFIG.TASK_COLUMNS.COMPLETED_AT - 1]
    };

  }

};
