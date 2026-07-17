function setupDesk() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const sheets = [
    "Projects",
    "Tasks",
    "Timeline",
    "Settings",
    CONFIG.SHEETS.WORKSPACES,
    CONFIG.SHEETS.WORKSPACE_ALIASES
  ];

  sheets.forEach(name => {
    if (!ss.getSheetByName(name)) {
      ss.insertSheet(name);
    }
  });

  const defaultSheet = ss.getSheetByName("Foglio1");
  if (defaultSheet) {
    ss.deleteSheet(defaultSheet);
  }

  const workspaceSheet = ss.getSheetByName(CONFIG.SHEETS.WORKSPACES);
  if (workspaceSheet.getLastRow() === 0) {
    workspaceSheet.appendRow(WORKSPACE_HEADERS);
  }

  const aliasSheet = ss.getSheetByName(CONFIG.SHEETS.WORKSPACE_ALIASES);
  if (aliasSheet.getLastRow() === 0) {
    aliasSheet.appendRow(WORKSPACE_ALIAS_HEADERS);
  }

  SpreadsheetApp.getUi().alert("Desk inizializzato.");
}
