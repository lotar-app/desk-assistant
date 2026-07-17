function testTaskIdRepair() {
  assertTaskIdRepair(TaskIdRepairMigration.schemaValid(TASK_HEADERS),
    "Schema Tasks esatto rifiutato.");
  assertTaskIdRepair(TaskIdRepairMigration.schemaValid(
    TASK_HEADERS.concat(["", ""])
  ), "Colonne vuote finali rifiutate.");
  assertTaskIdRepair(!TaskIdRepairMigration.schemaValid(TASK_HEADERS.slice(0, -1)),
    "Colonna mancante accettata.");
  const renamedHeaders = TASK_HEADERS.slice();
  renamedHeaders[2] = "Renamed";
  assertTaskIdRepair(!TaskIdRepairMigration.schemaValid(renamedHeaders),
    "Header rinominato accettato.");
  const reorderedHeaders = TASK_HEADERS.slice();
  const swap = reorderedHeaders[1];
  reorderedHeaders[1] = reorderedHeaders[2];
  reorderedHeaders[2] = swap;
  assertTaskIdRepair(!TaskIdRepairMigration.schemaValid(reorderedHeaders),
    "Ordine differente accettato.");
  const insertedHeaders = TASK_HEADERS.slice();
  insertedHeaders.splice(3, 0, "");
  assertTaskIdRepair(!TaskIdRepairMigration.schemaValid(insertedHeaders),
    "Colonna interposta accettata.");
  assertTaskIdRepair(!TaskIdRepairMigration.schemaValid(
    TASK_HEADERS.concat(["Extra"])
  ), "Header aggiuntivo nominato accettato.");

  const originalIdExists = TaskRepository.idExists;
  const originalFormatDate = Utilities.formatDate;
  const existing = {
    "TSK-20260717120000123": true,
    "TSK-20260717120000123-001": true
  };
  TaskRepository.idExists = id => existing[id] === true;
  Utilities.formatDate = () => "TSK-20260717120000123";
  try {
    assertTaskIdRepair(
      TaskService.nextUniqueId(new Date(0)) === "TSK-20260717120000123-002",
      "Sequenza deterministica Task ID non valida."
    );
  } finally {
    TaskRepository.idExists = originalIdExists;
    Utilities.formatDate = originalFormatDate;
  }

  const fixture = taskIdRepairFixture();
  const diagnosis = TaskIdRepairMigration.diagnose(fixture.dataSource);
  assertTaskIdRepair(diagnosis.duplicates.length === 3,
    "Gruppi duplicati fixture non rilevati.");
  const entries = diagnosis.duplicates.map(group => ({
    rowNumber: group.rows[1].rowNumber,
    oldTaskId: group.taskId,
    rowHash: group.rows[1].rowHash,
    newTaskId: TaskIdRepairMigration.repairId(group.taskId, 2)
  }));
  const manifest = taskIdRepairTestManifest(entries, diagnosis);
  const preflight = TaskIdRepairMigration.preflight(manifest, fixture.dataSource);
  assertTaskIdRepair(!preflight.pass && preflight.errors.some(error => (
    error.indexOf("VALIDATED_CLOSED") !== -1
  )), "La migrazione chiusa non viene rifiutata dal preflight.");
  assertTaskIdRepair(manifest.operations.every(operation => (
    Object.keys(operation.after).length === 1 && operation.after.ID
  )), "La migrazione autorizza campi diversi da Tasks.ID.");

  const baselineTasks = MigrationUtils.clone(fixture.tasks);
  entries.forEach(entry => {
    fixture.tasks.rows.find(row => row.rowNumber === entry.rowNumber)
      .values.ID = entry.newTaskId;
  });
  const postflight = TaskIdRepairMigration.postflight(
    manifest, fixture.dataSource, baselineTasks
  );
  assertTaskIdRepair(postflight.pass, "Postflight Task ID Repair fallito.");
  const rollback = TaskIdRepairMigration.rollbackPlan(
    manifest, fixture.dataSource, undefined, baselineTasks
  );
  assertTaskIdRepair(rollback.errors.length === 0 &&
    rollback.operations.length === 3 && rollback.executable === false,
    "Piano rollback Task ID Repair non valido.");

  const report = TaskIdRepairMigration.report(
    manifest, preflight, postflight,
    "2026-07-17T12:00:00.000Z", "2026-07-17T12:00:01.250Z", rollback
  );
  assertTaskIdRepair(report.durationMs === 1250 && report.updatedRows.length === 3 &&
    report.rollback.prepared === true && report.rollback.operations === 3,
    "Report Task ID Repair non valido.");

  return {
    success: true,
    generatorCollisionResolved: true,
    duplicateGroups: diagnosis.duplicates.length,
    repairOperations: manifest.operations.length,
    postflightPassed: postflight.pass,
    rollbackOperations: rollback.operations.length,
    reportDurationMs: report.durationMs,
    migrationClosed: true
  };
}

function taskIdRepairTestManifest(entries, diagnosis) {
  const operations = entries.map((entry, index) => ({
    operationId: "TEST-TASK-ID-REPAIR-" + String(index + 1),
    action: "UPDATE",
    sheet: CONFIG.SHEETS.TASKS,
    selector: { _rowNumber: entry.rowNumber, ID: entry.oldTaskId },
    after: { ID: entry.newTaskId }
  }));
  const manifest = {
    migrationId: TaskIdRepairMigration.MIGRATION_ID,
    version: "test",
    mode: "EXECUTION_READY",
    baseline: { sheets: { Tasks: {
      recordCount: diagnosis.taskCount,
      requiredHeaders: TASK_HEADERS
    }}},
    tasksChecksum: diagnosis.tasksChecksum,
    expectedDuplicateIds: TaskIdRepairMigration.EXPECTED_DUPLICATE_IDS.slice(),
    repairEntries: entries,
    operations: operations
  };
  manifest.fingerprint = MigrationUtils.checksum(manifest);
  return manifest;
}

function taskIdRepairFixture() {
  const ids = TaskIdRepairMigration.EXPECTED_DUPLICATE_IDS;
  const rows = [];
  let rowNumber = 2;
  ids.forEach((id, groupIndex) => {
    ["Prima", "Seconda"].forEach((title, occurrence) => {
      rows.push({
        rowNumber: rowNumber++,
        values: taskIdRepairRow(
          id, "PRJ-" + String(groupIndex + 1), title + " " + id,
          "2026-07-17T12:00:0" + occurrence + ".000Z"
        )
      });
    });
  });
  rows.push({
    rowNumber: rowNumber,
    values: taskIdRepairRow(
      "TSK-UNIQUE", "PRJ-4", "Unica", "2026-07-17T12:01:00.000Z"
    )
  });
  const tasks = {
    name: CONFIG.SHEETS.TASKS,
    exists: true,
    headers: TASK_HEADERS.concat(["", ""]),
    rows: rows
  };
  return {
    tasks: tasks,
    dataSource: {
      readSheet(name) {
        if (name !== CONFIG.SHEETS.TASKS) {
          return { name: name, exists: false, headers: [], rows: [] };
        }
        return MigrationUtils.clone(tasks);
      }
    }
  };
}

function taskIdRepairRow(id, projectId, title, createdAt) {
  return {
    ID: id,
    ProjectID: projectId,
    Title: title,
    Description: "",
    Status: CONFIG.TASK_STATUS.OPEN,
    Priority: CONFIG.TASK_PRIORITY.NORMAL,
    Assignee: CONFIG.DEFAULT_OWNER,
    DueDate: "",
    CreatedAt: createdAt,
    UpdatedAt: createdAt,
    CompletedAt: ""
  };
}

function assertTaskIdRepair(condition, message) {
  if (!condition) throw new Error(message);
}
