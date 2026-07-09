function setupDesk() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const sheets = ["Projects", "Tasks", "Timeline", "Settings"];

  sheets.forEach(name => {
    if (!ss.getSheetByName(name)) {
      ss.insertSheet(name);
    }
  });

  const defaultSheet = ss.getSheetByName("Foglio1");
  if (defaultSheet) {
    ss.deleteSheet(defaultSheet);
  }

  SpreadsheetApp.getUi().alert("Desk inizializzato.");
}