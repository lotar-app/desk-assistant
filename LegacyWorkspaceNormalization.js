const LegacyWorkspaceNormalization = {

  MIGRATION_ID: "LEGACY_WORKSPACE_NORMALIZATION_V1",
  VERSION: "1.0.0",
  MODE: "EXECUTION_READY",

  ACCEPTED_HEADERS: [
    "ID", "Progetto", "Stato", "Focus", "Responsabile",
    "Prossima azione", "Creato il", "Ultimo aggiornamento", ""
  ],

  FINAL_HEADERS: [
    "ID", "Progetto", "Stato", "Focus", "Responsabile",
    "Prossima azione", "Creato il", "Ultimo aggiornamento"
  ],

  APPROVED_LEGACY_MAPPING: {
    "PRJ-20260716142952": "CLIENTI",
    "PRJ-20260716141419": "CLIENTI",
    "PRJ-20260716121441": "LOTAR",
    "PRJ-20260710095800": "LOTAR",
    "PRJ-20260716103301": "LOTAR",
    "PRJ-20260716091407": "LOTAR",
    "PRJ-20260716080119": "LOTAR",
    "PRJ-20260709095234": "LOTAR",
    "PRJ-20260708130248": "LOTAR",
    "PRJ-20260710130212": "LOTAR",
    "PRJ-20260714130206": "LOTAR"
  },

  fingerprintPayload() {
    return {
      migrationId: this.MIGRATION_ID,
      version: this.VERSION,
      acceptedHeaders: this.ACCEPTED_HEADERS,
      finalHeaders: this.FINAL_HEADERS,
      approvedLegacyWorkspaceMapping: this.APPROVED_LEGACY_MAPPING,
      expectedProjectCount: Object.keys(this.APPROVED_LEGACY_MAPPING).length,
      semanticOperation: {
        action: "NORMALIZE_LEGACY_WORKSPACE_COLUMN",
        sheet: CONFIG.SHEETS.PROJECTS,
        sourceColumn: 9,
        finalState: "WORKSPACE_FOUNDATION_V1_LEGACY_BASELINE"
      }
    };
  },

  fingerprint() {
    return MigrationUtils.checksum(this.fingerprintPayload());
  },

  forSpreadsheet(spreadsheet) {
    const source = MigrationDataSource.forSpreadsheet(spreadsheet);
    source.readProjectFormulas = function() {
      const sheet = spreadsheet.getSheetByName(CONFIG.SHEETS.PROJECTS);
      if (!sheet || sheet.getLastRow() < 2) return [];
      const range = sheet.getRange(2, 9, sheet.getLastRow() - 1, 1);
      return typeof range.getFormulas === "function" ? range.getFormulas() : [];
    };
    return source;
  },

  diagnose(dataSource) {
    const projects = dataSource.readSheet(CONFIG.SHEETS.PROJECTS);
    const workspaces = dataSource.readSheet(CONFIG.SHEETS.WORKSPACES);
    const aliases = dataSource.readSheet(CONFIG.SHEETS.WORKSPACE_ALIASES);
    const tasks = dataSource.readSheet(CONFIG.SHEETS.TASKS);
    const timeline = dataSource.readSheet(CONFIG.SHEETS.TIMELINE);
    const settings = dataSource.readSheet(CONFIG.SHEETS.SETTINGS);
    const assignments = projects.rows.map(row => ({
      projectId: String(row.values.ID || ""),
      rowNumber: row.rowNumber,
      legacyWorkspace: String(row.rawValues[8] || ""),
      rowChecksum: MigrationUtils.checksum(row.rawValues)
    }));
    const projectFormulas = typeof dataSource.readProjectFormulas === "function"
      ? dataSource.readProjectFormulas() : [];
    return {
      readOnly: true,
      projects: projects,
      workspacesExists: workspaces.exists === true,
      workspaceAliasesExists: aliases.exists === true,
      legacyAssignments: assignments,
      projectFormulas: projectFormulas,
      projectsChecksum: MigrationUtils.checksum(projects),
      projectsAHChecksum: MigrationUtils.checksum({
        headers: projects.headers.slice(0, 8),
        rows: projects.rows.map(row => row.rawValues.slice(0, 8))
      }),
      otherSheetsChecksums: {
        Tasks: MigrationUtils.checksum(tasks),
        Timeline: MigrationUtils.checksum(timeline),
        Settings: MigrationUtils.checksum(settings)
      }
    };
  },

  preflight(dataSource) {
    const diagnosis = this.diagnose(dataSource);
    const errors = [];
    const projects = diagnosis.projects;
    const expectedIds = Object.keys(this.APPROVED_LEGACY_MAPPING).sort();
    const actualIds = diagnosis.legacyAssignments.map(item => item.projectId);
    this.require(errors, projects.exists === true, "PROJECTS_MISSING",
      "Il foglio Projects non esiste.");
    this.require(errors,
      MigrationUtils.valuesEqual(projects.headers, this.ACCEPTED_HEADERS),
      "PROJECTS_SCHEMA_INCOMPATIBLE", "Schema nominale Projects non valido.");
    this.require(errors, projects.rows.length === expectedIds.length,
      "PROJECT_COUNT_MISMATCH", "Numero progetti divergente.");
    this.require(errors, actualIds.every(Boolean), "PROJECT_ID_EMPTY",
      "Project ID vuoto.");
    this.require(errors, this.duplicates(actualIds).length === 0,
      "PROJECT_ID_DUPLICATE", "Project ID duplicato.");
    this.require(errors,
      MigrationUtils.valuesEqual(actualIds.slice().sort(), expectedIds),
      "PROJECT_ID_SET_MISMATCH", "Insieme Project ID divergente.");
    diagnosis.legacyAssignments.forEach(item => this.require(errors,
      item.legacyWorkspace === this.APPROVED_LEGACY_MAPPING[item.projectId],
      "LEGACY_WORKSPACE_MISMATCH",
      "Workspace nominale divergente per " + item.projectId));
    this.require(errors, diagnosis.projectFormulas.every(row => (
      !String(row[0] || "")
    )), "LEGACY_WORKSPACE_FORMULA",
    "La colonna workspace nominale contiene formule.");
    this.require(errors, diagnosis.workspacesExists !== true,
      "WORKSPACES_ALREADY_EXISTS", "Workspaces esiste già.");
    this.require(errors, diagnosis.workspaceAliasesExists !== true,
      "ALIASES_ALREADY_EXISTS", "WorkspaceAliases esiste già.");
    return {
      readOnly: true,
      migrationId: this.MIGRATION_ID,
      pass: errors.length === 0,
      status: errors.length ? "PREFLIGHT_FAILED" : "PREFLIGHT_PASSED",
      fingerprint: this.fingerprint(),
      projectsChecksum: diagnosis.projectsChecksum,
      projectsAHChecksum: diagnosis.projectsAHChecksum,
      expectedHeaders: this.ACCEPTED_HEADERS.slice(),
      actualHeaders: projects.headers.slice(),
      projectCount: projects.rows.length,
      expectedProjectIds: expectedIds,
      actualProjectIds: actualIds.slice().sort(),
      legacyAssignments: diagnosis.legacyAssignments,
      otherSheetsChecksums: diagnosis.otherSheetsChecksums,
      errors: errors,
      warnings: []
    };
  },

  manifest(dataSource) {
    const preflight = this.preflight(dataSource);
    if (!preflight.pass) {
      throw new Error("Preflight normalizzazione fallito: " +
        preflight.errors.map(error => error.code).join(", "));
    }
    const manifest = {
      migrationId: this.MIGRATION_ID,
      version: this.VERSION,
      mode: this.MODE,
      fingerprint: this.fingerprint(),
      baseline: { sheets: {
        Projects: { recordCount: preflight.projectCount,
          requiredHeaders: this.ACCEPTED_HEADERS,
          idField: "ID", ids: preflight.expectedProjectIds },
        Tasks: { recordCount: null, requiredHeaders: [] },
        Timeline: { recordCount: null, requiredHeaders: [] },
        Settings: { recordCount: null, requiredHeaders: [] }
      }},
      baselineState: {
        projectsChecksum: preflight.projectsChecksum,
        projectsAHChecksum: preflight.projectsAHChecksum,
        otherSheetsChecksums: preflight.otherSheetsChecksums,
        workspacesSheetExists: false,
        workspaceAliasesSheetExists: false
      },
      legacyAssignments: MigrationUtils.clone(preflight.legacyAssignments),
      operations: [{
        operationId: "LWN-001-NORMALIZE-PROJECTS",
        action: "NORMALIZE_LEGACY_WORKSPACE_COLUMN",
        sheet: CONFIG.SHEETS.PROJECTS,
        column: 9,
        affectedProjectIds: preflight.expectedProjectIds
      }],
      expectedFinalState: {
        projectsHeaders: this.FINAL_HEADERS,
        projectCount: preflight.projectCount,
        projectIds: preflight.expectedProjectIds,
        workspacesSheetExists: false,
        workspaceAliasesSheetExists: false
      }
    };
    const prepared = MigrationManifest.prepare(manifest);
    manifest.manifestChecksum = prepared.checksum;
    manifest.manifestSignature = prepared.signature;
    return manifest;
  },

  verifyManifest(manifest) {
    if (!manifest || manifest.fingerprint !== this.fingerprint()) return false;
    const payload = MigrationUtils.clone(manifest);
    const checksum = payload.manifestChecksum;
    const signature = payload.manifestSignature;
    delete payload.manifestChecksum;
    delete payload.manifestSignature;
    const prepared = MigrationManifest.prepare(payload);
    return checksum === prepared.checksum && signature === prepared.signature;
  },

  postflight(dataSource, manifest) {
    const projects = dataSource.readSheet(CONFIG.SHEETS.PROJECTS);
    const errors = [];
    const ids = projects.rows.map(row => String(row.values.ID || ""));
    this.require(errors,
      MigrationUtils.valuesEqual(projects.headers, this.FINAL_HEADERS),
      "FINAL_PROJECTS_SCHEMA", "Projects non coincide con la baseline finale.");
    this.require(errors, projects.rows.length === manifest.expectedFinalState.projectCount,
      "FINAL_PROJECT_COUNT", "Conteggio Projects divergente.");
    this.require(errors, MigrationUtils.valuesEqual(
      ids.slice().sort(), manifest.expectedFinalState.projectIds
    ), "FINAL_PROJECT_IDS", "Project ID finali divergenti.");
    const ahChecksum = MigrationUtils.checksum({
      headers: projects.headers.slice(0, 8),
      rows: projects.rows.map(row => row.rawValues.slice(0, 8))
    });
    this.require(errors, ahChecksum === manifest.baselineState.projectsAHChecksum,
      "PROJECTS_AH_CHANGED", "Projects A:H è cambiato.");
    this.require(errors,
      dataSource.readSheet(CONFIG.SHEETS.WORKSPACES).exists !== true,
      "FINAL_WORKSPACES_PRESENT", "Workspaces non deve esistere.");
    this.require(errors,
      dataSource.readSheet(CONFIG.SHEETS.WORKSPACE_ALIASES).exists !== true,
      "FINAL_ALIASES_PRESENT", "WorkspaceAliases non deve esistere.");
    ["Tasks", "Timeline", "Settings"].forEach(name => this.require(errors,
      MigrationUtils.checksum(dataSource.readSheet(name)) ===
        manifest.baselineState.otherSheetsChecksums[name],
      name.toUpperCase() + "_CHANGED", name + " è cambiato."));
    return { readOnly: true, migrationId: this.MIGRATION_ID,
      pass: errors.length === 0,
      status: errors.length ? "POSTFLIGHT_FAILED" : "POSTFLIGHT_PASSED",
      projectsAHChecksum: ahChecksum, projectCount: projects.rows.length,
      projectIds: ids, workspaceFoundationProjectsSchemaAccepted:
        MigrationUtils.valuesEqual(projects.headers, this.FINAL_HEADERS),
      unchangedSheets: errors.length ? [] : ["Tasks", "Timeline", "Settings"],
      errors: errors, warnings: [] };
  },

  duplicates(values) {
    const seen = Object.create(null);
    return values.filter(value => {
      const key = String(value);
      if (seen[key]) return true;
      seen[key] = true;
      return false;
    });
  },

  require(errors, condition, code, message) {
    if (!condition) errors.push({ code: code, message: message });
  }
};
