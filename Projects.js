function newProject() {

  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName(CONFIG.SHEETS.PROJECTS);

  if (sheet.getLastRow() === 0) {

    sheet.appendRow(PROJECT_HEADERS);

  }

  const ui = SpreadsheetApp.getUi();

  const nome = ui.prompt("Nome progetto").getResponseText().trim();

  if (!nome) return;

  ProjectService.create(nome);

  ui.alert("Progetto creato.");

}