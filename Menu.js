function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Desk")
    .addItem("Nuovo progetto", "newProject")
    .addItem("Aggiorna progetto", "showUpdateProject")
    .addItem("Nuova attività", "newTask")
    .addSeparator()
    .addItem("Aggiorna Dashboard", "refreshDesk")
    .addToUi();
}