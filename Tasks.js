function newTask() {

  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName(CONFIG.SHEETS.TASKS);

  if (sheet.getLastRow() === 0) {

    sheet.appendRow(TASK_HEADERS);

  }

  const ui = SpreadsheetApp.getUi();
  const projects = ProjectRepository.list();

  if (projects.length === 0) {
    ui.alert("Nessun progetto disponibile.");
    return;
  }

  const projectList = projects
    .map((project, index) => (index + 1) + ". " + project.name)
    .join("\n");

  const projectResponse = ui
    .prompt("Scegli progetto", projectList, ui.ButtonSet.OK_CANCEL);

  if (projectResponse.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  const projectIndex = Number(projectResponse.getResponseText().trim()) - 1;
  const project = projects[projectIndex];

  if (!project) {
    ui.alert("Progetto non valido.");
    return;
  }

  const titleResponse = ui
    .prompt("Titolo attività", ui.ButtonSet.OK_CANCEL);

  if (titleResponse.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  const title = titleResponse.getResponseText().trim();

  if (!title) return;

  TaskService.create(project.id, {
    title: title
  });

  ui.alert("Attività creata.");

}
