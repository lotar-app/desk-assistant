function taskIdRepairDiagnose() {
  const diagnosis = TaskIdRepairMigration.diagnose();
  const tasks = MigrationDataSource.readSheet(CONFIG.SHEETS.TASKS);
  const report = {
    schemaValid: diagnosis.schemaValid,
    taskCount: diagnosis.taskCount,
    duplicateGroupCount: diagnosis.duplicates.length,
    tasksChecksum: diagnosis.tasksChecksum,
    actualColumnCount: tasks.headers.length,
    expectedColumnCount: TASK_HEADERS.length,
    actualHeaders: tasks.headers.slice(),
    expectedHeaders: TASK_HEADERS.slice(),
    extraHeaders: tasks.headers.slice(TASK_HEADERS.length),
    duplicateGroups: diagnosis.duplicates.map(group => ({
      oldTaskId: group.taskId,
      occurrences: group.occurrences,
      rows: group.rows.map((row, index) => ({
        occurrence: index + 1,
        rowNumber: row.rowNumber,
        projectId: String(row.values.ProjectID || ""),
        title: String(row.values.Title || ""),
        rowHash: row.rowHash,
        newTaskId: index === 0
          ? group.taskId
          : TaskIdRepairMigration.repairId(group.taskId, index + 1)
      }))
    }))
  };
  console.log(JSON.stringify(report));
  return report;
}

function taskIdRepairExecuteApprovedV1() {
  return taskIdRepairExecuteApprovedV1Internal_();
}

function authorizeTaskIdRepair() {
  const requiredScopes = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/script.external_request"
  ];
  ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, requiredScopes);
  return {
    authorized: true,
    scopes: requiredScopes
  };
}

function taskIdRepairValidateAppliedState() {
  return taskIdRepairValidateAppliedStateInternal_();
}
