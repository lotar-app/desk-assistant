function taskIdRepairValidateAppliedStateInternal_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const manifest = TaskIdRepairMigration.frozenManifest();
  const backupSelection = taskIdRepairFindVerifiedBaseline_(
    spreadsheet, manifest
  );
  const errors = backupSelection.errors.slice();
  const expectedByRow = {};
  manifest.repairEntries.forEach(entry => {
    expectedByRow[Number(entry.rowNumber)] = entry;
  });

  if (!backupSelection.spreadsheet) {
    return taskIdRepairRecoveryReport_({
      status: "RECOVERY_VALIDATION_FAILED",
      errors: errors,
      backupCandidates: backupSelection.candidateCount
    });
  }

  const currentMatrix = taskIdRepairCanonicalMatrix_(spreadsheet);
  const baselineMatrix = taskIdRepairCanonicalMatrix_(
    backupSelection.spreadsheet
  );
  const differences = [];

  if (currentMatrix.length !== baselineMatrix.length ||
      currentMatrix.length !== TaskIdRepairMigration.TASK_COUNT + 1) {
    errors.push("Numero righe Tasks divergente dalla baseline.");
  }

  const maxRows = Math.max(currentMatrix.length, baselineMatrix.length);
  for (let rowIndex = 0; rowIndex < maxRows; rowIndex++) {
    const currentRow = currentMatrix[rowIndex] || [];
    const baselineRow = baselineMatrix[rowIndex] || [];
    for (let columnIndex = 0; columnIndex < TASK_HEADERS.length; columnIndex++) {
      if (!MigrationUtils.valuesEqual(
        currentRow[columnIndex], baselineRow[columnIndex]
      )) {
        differences.push({
          rowNumber: rowIndex + 1,
          column: columnIndex + 1,
          header: TASK_HEADERS[columnIndex]
        });
      }
    }
  }

  const expectedDifferences = manifest.repairEntries.map(entry => ({
    rowNumber: entry.rowNumber,
    column: CONFIG.TASK_COLUMNS.ID,
    header: "ID"
  }));
  if (!MigrationUtils.valuesEqual(differences, expectedDifferences)) {
    errors.push("Le differenze canoniche non sono esclusivamente i tre ID.");
  }

  manifest.repairEntries.forEach(entry => {
    const baselineId = baselineMatrix[entry.rowNumber - 1] &&
      String(baselineMatrix[entry.rowNumber - 1][0] || "");
    const currentId = currentMatrix[entry.rowNumber - 1] &&
      String(currentMatrix[entry.rowNumber - 1][0] || "");
    if (baselineId !== entry.oldTaskId || currentId !== entry.newTaskId) {
      errors.push("ID divergente alla riga " + entry.rowNumber + ".");
    }
  });

  const currentIds = currentMatrix.slice(1).map(row => String(row[0] || "").trim());
  if (TaskIdRepairMigration.duplicates(currentIds).length !== 0) {
    errors.push("Task ID duplicati residui.");
  }

  const reconstructed = MigrationUtils.clone(currentMatrix);
  manifest.repairEntries.forEach(entry => {
    reconstructed[entry.rowNumber - 1][0] = entry.oldTaskId;
  });
  if (!MigrationUtils.valuesEqual(reconstructed, baselineMatrix)) {
    errors.push("La matrice canonica ricostruita diverge dalla baseline.");
  }

  return taskIdRepairRecoveryReport_({
    status: errors.length === 0
      ? "RECOVERY_VALIDATED"
      : "RECOVERY_VALIDATION_FAILED",
    errors: errors,
    backupCandidates: backupSelection.candidateCount,
    taskCount: currentMatrix.length - 1,
    duplicateGroupCount: TaskIdRepairMigration.duplicates(currentIds).length,
    differences: differences,
    canonicalBaselineChecksum: MigrationUtils.checksum(baselineMatrix),
    canonicalCurrentChecksum: MigrationUtils.checksum(currentMatrix),
    canonicalReconstructedChecksum: MigrationUtils.checksum(reconstructed),
    expectedNewIds: manifest.repairEntries.map(entry => ({
      rowNumber: entry.rowNumber,
      taskId: entry.newTaskId
    }))
  });
}

function taskIdRepairFindVerifiedBaseline_(spreadsheet, manifest) {
  const sourceFile = DriveApp.getFileById(spreadsheet.getId());
  const parents = sourceFile.getParents();
  const folder = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const prefix = spreadsheet.getName() + "-" + manifest.migrationId + "-";
  const candidates = [];
  const files = folder.getFiles();

  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName();
    if (name.indexOf(prefix) === 0 && /-backup$/.test(name)) {
      try {
        const candidateSpreadsheet = SpreadsheetApp.openById(file.getId());
        const candidateTasks = MigrationDataSource.forSpreadsheet(
          candidateSpreadsheet
        ).readSheet(CONFIG.SHEETS.TASKS);
        if (MigrationUtils.checksum(candidateTasks) === manifest.tasksChecksum) {
          candidates.push({
            file: file,
            spreadsheet: candidateSpreadsheet,
            createdAt: file.getDateCreated().getTime()
          });
        }
      } catch (error) {
        // Un file non apribile o non Spreadsheet non è una baseline valida.
      }
    }
  }

  candidates.sort((left, right) => right.createdAt - left.createdAt);
  return {
    spreadsheet: candidates.length ? candidates[0].spreadsheet : null,
    candidateCount: candidates.length,
    errors: candidates.length ? [] : [
      "Nessuna copia fisica con checksum Tasks baseline verificato."
    ]
  };
}

function taskIdRepairCanonicalMatrix_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(CONFIG.SHEETS.TASKS);
  return sheet.getRange(
    1, 1, sheet.getLastRow(), TASK_HEADERS.length
  ).getValues().map(row => row.map(value => (
    MigrationUtils.normalizeValue(value)
  )));
}

function taskIdRepairRecoveryReport_(data) {
  const report = {
    migrationId: "TASK_ID_REPAIR_V1",
    readOnly: true,
    status: data.status,
    taskCount: data.taskCount || 0,
    duplicateGroupCount: data.duplicateGroupCount === undefined
      ? null : data.duplicateGroupCount,
    backupCandidates: data.backupCandidates || 0,
    differences: data.differences || [],
    expectedNewIds: data.expectedNewIds || [],
    canonicalBaselineChecksum: data.canonicalBaselineChecksum || "",
    canonicalCurrentChecksum: data.canonicalCurrentChecksum || "",
    canonicalReconstructedChecksum:
      data.canonicalReconstructedChecksum || "",
    onlyAuthorizedIdsDiffer: data.status === "RECOVERY_VALIDATED",
    errors: data.errors || []
  };
  console.log(JSON.stringify(report));
  return report;
}
