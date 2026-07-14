/**
 * WORKSPACE SETTINGS
 *
 * Risolve il contesto operativo senza introdurre utenti o autorizzazioni.
 */

const WorkspaceSettings = {

  normalize(workspace) {
    return String(workspace || CONFIG.DEFAULT_WORKSPACE).trim().toUpperCase();
  },

  get(key) {
    const sheet = SpreadsheetApp
      .getActiveSpreadsheet()
      .getSheetByName(CONFIG.SHEETS.SETTINGS);

    if (!sheet || sheet.getLastRow() === 0) {
      return "";
    }

    const values = sheet.getDataRange().getValues();

    for (let i = 0; i < values.length; i++) {
      if (
        String(values[i][CONFIG.SETTINGS_COLUMNS.KEY - 1] || "").trim() === key
      ) {
        return values[i][CONFIG.SETTINGS_COLUMNS.VALUE - 1];
      }
    }

    return "";
  },

  defaultWorkspace() {
    return this.normalize(this.get("defaultWorkspace"));
  },

  resolve(workspace) {
    const value = String(workspace || "").trim();
    return value ? this.normalize(value) : this.defaultWorkspace();
  }

};
