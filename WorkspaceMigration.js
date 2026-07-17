const WorkspaceMigration = {

  MIGRATION_ID: "WORKSPACE_FOUNDATION_V1",
  VERSION: "1.0.0",
  MODE: "EXECUTION_READY",
  CREATED_AT: "2026-07-17T00:00:00.000Z",

  APPROVED_WORKSPACES: [{
    ID: "WS0001", Name: "LOTAR", IsDefault: true, Status: "ACTIVE"
  }, {
    ID: "WS0002", Name: "CLIENTI", IsDefault: false, Status: "ACTIVE"
  }],

  APPROVED_ALIASES: [{ Alias: "Lotar", WorkspaceID: "WS0001" }, {
    Alias: "Freelance", WorkspaceID: "WS0002"
  }, {
    Alias: "Clienti", WorkspaceID: "WS0002"
  }],

  APPROVED_PROJECT_MAPPING: {
    "PRJ-20260716142952": "WS0002",
    "PRJ-20260716141419": "WS0002",
    "PRJ-20260716121441": "WS0001",
    "PRJ-20260710095800": "WS0001",
    "PRJ-20260716103301": "WS0001",
    "PRJ-20260716091407": "WS0001",
    "PRJ-20260716080119": "WS0001",
    "PRJ-20260709095234": "WS0001",
    "PRJ-20260708130248": "WS0001",
    "PRJ-20260710130212": "WS0001",
    "PRJ-20260714130206": "WS0001"
  },

  structuralOperations() {
    return [{
      operationId: "WS-001-ADD-PROJECT-COLUMN",
      action: "ADD_COLUMN", sheet: CONFIG.SHEETS.PROJECTS,
      after: { header: "WorkspaceID", position: 9 },
      reason: "Aggiunta deterministica della nona colonna WorkspaceID."
    }, {
      operationId: "WS-002-CREATE-WORKSPACES-SHEET",
      action: "CREATE_SHEET", sheet: CONFIG.SHEETS.WORKSPACES,
      after: { headers: WORKSPACE_HEADERS }, reason: "Creazione Workspaces."
    }, {
      operationId: "WS-003-CREATE-ALIASES-SHEET",
      action: "CREATE_SHEET", sheet: CONFIG.SHEETS.WORKSPACE_ALIASES,
      after: { headers: WORKSPACE_ALIAS_HEADERS },
      reason: "Creazione WorkspaceAliases."
    }];
  },

  fingerprintPayload() {
    return {
      migrationId: this.MIGRATION_ID,
      version: this.VERSION,
      mode: this.MODE,
      createdAt: this.CREATED_AT,
      workspaces: MigrationUtils.clone(this.APPROVED_WORKSPACES),
      aliases: MigrationUtils.clone(this.APPROVED_ALIASES),
      projectMapping: MigrationUtils.clone(this.APPROVED_PROJECT_MAPPING),
      structuralOperations: this.structuralOperations()
    };
  },

  fingerprint() {
    return MigrationUtils.checksum(this.fingerprintPayload());
  },

  schemaStatus(dataSource) {
    dataSource = dataSource || MigrationDataSource.forSpreadsheet(
      SpreadsheetApp.getActiveSpreadsheet()
    );
    const projects = dataSource.readSheet(CONFIG.SHEETS.PROJECTS);
    const workspaces = dataSource.readSheet(CONFIG.SHEETS.WORKSPACES);
    const aliases = dataSource.readSheet(CONFIG.SHEETS.WORKSPACE_ALIASES);
    return {
      readOnly: true,
      projectsWorkspaceHeader: String(projects.headers[8] || ""),
      workspacesSheetExists: workspaces.exists === true,
      workspaceAliasesSheetExists: aliases.exists === true,
      ready: MigrationUtils.valuesEqual(projects.headers, PROJECT_HEADERS) &&
        workspaces.exists === true && aliases.exists === true
    };
  },

  preflight(dataSource) {
    dataSource = dataSource || MigrationDataSource.forSpreadsheet(
      SpreadsheetApp.getActiveSpreadsheet()
    );
    const projects = dataSource.readSheet(CONFIG.SHEETS.PROJECTS);
    const workspaces = dataSource.readSheet(CONFIG.SHEETS.WORKSPACES);
    const aliases = dataSource.readSheet(CONFIG.SHEETS.WORKSPACE_ALIASES);
    const migrationLog = dataSource.readSheet(CONFIG.SHEETS.MIGRATION_LOG);
    const tasks = dataSource.readSheet(CONFIG.SHEETS.TASKS);
    const timeline = dataSource.readSheet(CONFIG.SHEETS.TIMELINE);
    const settings = dataSource.readSheet(CONFIG.SHEETS.SETTINGS);
    const errors = [];
    const warnings = [];
    const legacyHeaders = PROJECT_HEADERS.slice(0, 8);
    const expectedIds = Object.keys(this.APPROVED_PROJECT_MAPPING).sort();
    const actualIds = projects.rows.map(row => String(row.values.ID || ""));

    this.require(errors, projects.exists === true, "PROJECTS_MISSING",
      "Il foglio Projects non esiste.");
    this.require(errors, MigrationUtils.valuesEqual(projects.headers, legacyHeaders),
      "PROJECTS_SCHEMA_INCOMPATIBLE",
      "Projects deve avere esattamente gli otto header legacy approvati.");
    this.require(errors, actualIds.every(Boolean), "PROJECT_ID_EMPTY",
      "Projects contiene Project ID vuoti.");
    this.require(errors, this.duplicates(actualIds).length === 0,
      "PROJECT_ID_DUPLICATE", "Projects contiene Project ID duplicati.");
    this.require(errors,
      MigrationUtils.valuesEqual(actualIds.slice().sort(), expectedIds),
      "PROJECT_ID_SET_MISMATCH",
      "L'insieme dei Project ID non coincide esattamente con il mapping approvato.");

    this.require(errors, tasks.exists === true &&
      MigrationDataSource.headersMatchWithEmptyTail(
        tasks.headers, TASK_HEADERS
      ),
      "TASKS_SCHEMA_INCOMPATIBLE", "Schema Tasks non compatibile.");
    this.require(errors, timeline.exists === true &&
      MigrationUtils.valuesEqual(timeline.headers, TIMELINE_HEADERS),
      "TIMELINE_SCHEMA_INCOMPATIBLE", "Schema Timeline non compatibile.");
    this.require(errors, settings.exists === true &&
      MigrationUtils.valuesEqual(settings.headers, SETTINGS_HEADERS),
      "SETTINGS_SCHEMA_INCOMPATIBLE", "Schema Settings non compatibile.");
    const taskIds = tasks.rows.map(row => String(row.values.ID || ""));
    this.require(errors, taskIds.every(Boolean), "TASK_ID_EMPTY",
      "Tasks contiene ID vuoti.");
    this.require(errors, this.duplicates(taskIds).length === 0,
      "TASK_ID_DUPLICATE", "Tasks contiene ID duplicati.");
    tasks.rows.forEach(row => this.require(errors,
      expectedIds.indexOf(String(row.values.ProjectID || "")) !== -1,
      "TASK_PROJECT_ORPHAN", "Task verso Project ID inesistente: " +
        String(row.values.ID || "[senza ID]")));
    timeline.rows.forEach((row, index) => this.require(errors,
      expectedIds.indexOf(String(row.values["Project ID"] || "")) !== -1,
      "TIMELINE_PROJECT_ORPHAN", "Timeline verso Project ID inesistente alla riga " +
        String(row.rowNumber || index + 2)));

    this.require(errors, workspaces.exists !== true, "WORKSPACES_ALREADY_EXISTS",
      "Workspaces esiste già: stato aggiornato o parziale non accettato.");
    this.require(errors, aliases.exists !== true, "ALIASES_ALREADY_EXISTS",
      "WorkspaceAliases esiste già: stato aggiornato o parziale non accettato.");

    if (workspaces.exists === true) {
      this.inspectExistingWorkspaces(workspaces, errors);
    }
    if (aliases.exists === true) {
      this.inspectExistingAliases(aliases, workspaces, errors);
    }

    const priorEntries = migrationLog.rows.filter(row => (
      String(row.values.MigrationID || "") === this.MIGRATION_ID
    ));
    this.require(errors, priorEntries.length === 0, "MIGRATION_ALREADY_RECORDED",
      "La migrazione Workspace risulta già registrata e non può essere rieseguita.");
    this.require(errors, migrationLog.exists !== true ||
      MigrationUtils.valuesEqual(migrationLog.headers, MIGRATION_LOG_HEADERS),
      "MIGRATION_LOG_SCHEMA_INCOMPATIBLE", "Schema MigrationLog non compatibile.");

    const approvedWorkspaceIds = this.APPROVED_WORKSPACES.map(item => item.ID);
    Object.keys(this.APPROVED_PROJECT_MAPPING).forEach(projectId => {
      this.require(errors,
        approvedWorkspaceIds.indexOf(this.APPROVED_PROJECT_MAPPING[projectId]) !== -1,
        "MAPPING_REFERENCE_INVALID",
        "Il mapping di " + projectId + " usa un Workspace ID non approvato.");
    });
    this.require(errors,
      this.APPROVED_WORKSPACES.filter(item => item.IsDefault === true).length === 1,
      "DEFAULT_COUNT_INVALID", "Deve esistere un solo workspace default.");
    this.require(errors,
      this.duplicates(approvedWorkspaceIds).length === 0,
      "APPROVED_WORKSPACE_ID_DUPLICATE", "Workspace ID approvati duplicati.");
    this.require(errors,
      this.duplicates(this.APPROVED_ALIASES.map(item => this.normalize(item.Alias))).length === 0,
      "APPROVED_ALIAS_DUPLICATE", "Alias approvati duplicati.");
    this.APPROVED_ALIASES.forEach(alias => {
      this.require(errors, approvedWorkspaceIds.indexOf(alias.WorkspaceID) !== -1,
        "ALIAS_REFERENCE_INVALID", "Alias con Workspace ID incoerente: " + alias.Alias);
    });

    return {
      readOnly: true,
      migrationId: this.MIGRATION_ID,
      pass: errors.length === 0,
      status: errors.length === 0 ? "PREFLIGHT_PASSED" : "PREFLIGHT_FAILED",
      expectedProjectIds: expectedIds,
      actualProjectIds: actualIds.slice().sort(),
      errors: errors,
      warnings: warnings
    };
  },

  manifest(dataSource) {
    const preflight = this.preflight(dataSource);
    if (!preflight.pass) {
      throw new Error("Preflight Workspace fallito: " +
        preflight.errors.map(error => error.code).join(", "));
    }
    const operations = this.structuralOperations();

    this.APPROVED_WORKSPACES.forEach((workspace, index) => {
      const record = MigrationUtils.clone(workspace);
      record.CreatedAt = this.CREATED_AT;
      record.UpdatedAt = this.CREATED_AT;
      operations.push({
        operationId: "WS-01" + (index + 1) + "-CREATE-" + workspace.ID,
        action: "CREATE", sheet: CONFIG.SHEETS.WORKSPACES,
        selector: { ID: workspace.ID }, after: record,
        reason: "Creazione workspace approvato."
      });
    });
    this.APPROVED_ALIASES.forEach((alias, index) => {
      const record = MigrationUtils.clone(alias);
      record.CreatedAt = this.CREATED_AT;
      operations.push({
        operationId: "WS-02" + (index + 1) + "-CREATE-ALIAS",
        action: "CREATE", sheet: CONFIG.SHEETS.WORKSPACE_ALIASES,
        selector: { Alias: alias.Alias }, after: record,
        reason: "Creazione alias approvato."
      });
    });
    Object.keys(this.APPROVED_PROJECT_MAPPING).sort().forEach((projectId, index) => {
      operations.push({
        operationId: "WS-1" + String(index + 1).padStart(2, "0") + "-ASSIGN-PROJECT",
        action: "UPDATE", sheet: CONFIG.SHEETS.PROJECTS,
        selector: { ID: projectId, WorkspaceID: "" },
        after: { WorkspaceID: this.APPROVED_PROJECT_MAPPING[projectId] },
        reason: "Assegnazione esclusiva da mapping ProjectID -> WorkspaceID approvato."
      });
    });

    return {
      migrationId: this.MIGRATION_ID,
      version: this.VERSION,
      mode: this.MODE,
      baseline: { sheets: {
        Projects: {
          recordCount: preflight.expectedProjectIds.length,
          requiredHeaders: PROJECT_HEADERS.slice(0, 8),
          idField: "ID", ids: preflight.expectedProjectIds
        },
        Tasks: {
          recordCount: dataSource.readSheet(CONFIG.SHEETS.TASKS).rows.length,
          requiredHeaders: TASK_HEADERS
        },
        Timeline: {
          recordCount: dataSource.readSheet(CONFIG.SHEETS.TIMELINE).rows.length,
          requiredHeaders: TIMELINE_HEADERS
        },
        Settings: {
          recordCount: dataSource.readSheet(CONFIG.SHEETS.SETTINGS).rows.length,
          requiredHeaders: SETTINGS_HEADERS
        },
        Workspaces: { recordCount: 0, requiredHeaders: [] },
        WorkspaceAliases: { recordCount: 0, requiredHeaders: [] },
        MigrationLog: { recordCount: 0, requiredHeaders: [] }
      }},
      expectedFinalCounts: {
        Projects: preflight.expectedProjectIds.length,
        Workspaces: 2,
        WorkspaceAliases: 3
      },
      operations: operations
    };
  },

  plan(mapping) {
    if (mapping && !MigrationUtils.valuesEqual(
      Object.keys(mapping).sort(), Object.keys(this.APPROVED_PROJECT_MAPPING).sort()
    )) {
      return { readOnly: true, valid: false, assignments: [],
        invalidAssignments: [{ reason: "MAPPING_NOT_APPROVED" }],
        projectsToClassify: [] };
    }
    const candidate = mapping || this.APPROVED_PROJECT_MAPPING;
    const invalid = Object.keys(candidate).filter(id => (
      candidate[id] !== this.APPROVED_PROJECT_MAPPING[id]
    ));
    return {
      readOnly: true, valid: invalid.length === 0,
      assignments: invalid.length ? [] : Object.keys(candidate).sort().map(id => ({
        projectId: id, afterWorkspaceId: candidate[id]
      })),
      invalidAssignments: invalid.map(id => ({
        projectId: id, workspaceId: candidate[id], reason: "MAPPING_NOT_APPROVED"
      })), projectsToClassify: []
    };
  },

  operations(mapping) {
    const plan = this.plan(mapping);
    if (!plan.valid) throw new Error("Mapping Workspace diverso da quello approvato.");
    return plan.assignments.map((assignment, index) => ({
      operationId: "WORKSPACE-ASSIGN-" + String(index + 1).padStart(3, "0"),
      action: "UPDATE", sheet: CONFIG.SHEETS.PROJECTS,
      selector: { ID: assignment.projectId, WorkspaceID: "" },
      after: { WorkspaceID: assignment.afterWorkspaceId },
      reason: "Assegnazione da mapping esplicito approvato."
    }));
  },

  report(result, startedAt, finishedAt) {
    const operations = (result && result.operations) || [];
    const applied = operations.filter(item => item.valid !== false);
    return {
      migrationId: this.MIGRATION_ID,
      structuralChanges: applied.filter(item => (
        item.action === "ADD_COLUMN" || item.action === "CREATE_SHEET"
      )).map(item => item.operationId),
      workspacesCreated: applied.filter(item => item.action === "CREATE" &&
        item.sheet === CONFIG.SHEETS.WORKSPACES).length,
      aliasesCreated: applied.filter(item => item.action === "CREATE" &&
        item.sheet === CONFIG.SHEETS.WORKSPACE_ALIASES).length,
      projectsUpdated: applied.filter(item => item.action === "UPDATE" &&
        item.sheet === CONFIG.SHEETS.PROJECTS).length,
      warnings: (result && result.warnings) || [],
      errors: (result && result.errors) || [],
      durationMs: Math.max(0, new Date(finishedAt).getTime() -
        new Date(startedAt).getTime()),
      outcome: result && result.success === true ? "SUCCESS" : "FAILED"
    };
  },

  postflight(dataSource) {
    const projects = dataSource.readSheet(CONFIG.SHEETS.PROJECTS);
    const workspaces = dataSource.readSheet(CONFIG.SHEETS.WORKSPACES);
    const aliases = dataSource.readSheet(CONFIG.SHEETS.WORKSPACE_ALIASES);
    const errors = [];
    this.require(errors, MigrationUtils.valuesEqual(projects.headers, PROJECT_HEADERS),
      "FINAL_PROJECTS_SCHEMA", "Schema finale Projects non valido.");
    this.require(errors, MigrationUtils.valuesEqual(workspaces.headers, WORKSPACE_HEADERS),
      "FINAL_WORKSPACES_SCHEMA", "Schema finale Workspaces non valido.");
    this.require(errors, MigrationUtils.valuesEqual(aliases.headers, WORKSPACE_ALIAS_HEADERS),
      "FINAL_ALIASES_SCHEMA", "Schema finale WorkspaceAliases non valido.");
    this.require(errors, workspaces.rows.length === 2, "FINAL_WORKSPACE_COUNT",
      "Numero workspace finale non valido.");
    this.require(errors, aliases.rows.length === 3, "FINAL_ALIAS_COUNT",
      "Numero alias finale non valido.");
    const workspaceIds = workspaces.rows.map(row => String(row.values.ID || ""));
    this.require(errors, this.duplicates(workspaceIds).length === 0,
      "FINAL_WORKSPACE_DUPLICATE", "Workspace ID finali duplicati.");
    this.require(errors, workspaces.rows.filter(row => (
      row.values.IsDefault === true || String(row.values.IsDefault).toLowerCase() === "true"
    )).length === 1, "FINAL_DEFAULT_COUNT", "Default finale non univoco.");
    const normalizedAliases = aliases.rows.map(row => this.normalize(row.values.Alias));
    this.require(errors, this.duplicates(normalizedAliases).length === 0,
      "FINAL_ALIAS_DUPLICATE", "Alias finali duplicati.");
    aliases.rows.forEach(row => this.require(errors,
      workspaceIds.indexOf(String(row.values.WorkspaceID || "")) !== -1,
      "FINAL_ALIAS_ORPHAN", "Alias finale orfano."));
    const seenProjects = {};
    projects.rows.forEach(row => {
      const id = String(row.values.ID || "");
      seenProjects[id] = true;
      this.require(errors, row.values.WorkspaceID === this.APPROVED_PROJECT_MAPPING[id],
        "FINAL_PROJECT_MAPPING", "Assegnazione finale divergente per " + id);
    });
    this.require(errors, MigrationUtils.valuesEqual(
      Object.keys(seenProjects).sort(), Object.keys(this.APPROVED_PROJECT_MAPPING).sort()
    ), "FINAL_PROJECT_SET", "Insieme finale dei progetti divergente.");
    return {
      readOnly: true,
      pass: errors.length === 0,
      status: errors.length === 0 ? "POSTFLIGHT_PASSED" : "POSTFLIGHT_FAILED",
      errors: errors,
      counts: {
        projects: projects.rows.length,
        workspaces: workspaces.rows.length,
        aliases: aliases.rows.length
      }
    };
  },

  inspectExistingWorkspaces(sheet, errors) {
    const ids = sheet.rows.map(row => String(row.values.ID || ""));
    const defaults = sheet.rows.filter(row => (
      row.values.IsDefault === true || String(row.values.IsDefault).toLowerCase() === "true"
    ));
    this.require(errors, this.duplicates(ids).length === 0,
      "EXISTING_WORKSPACE_ID_DUPLICATE", "Workspace ID esistenti duplicati.");
    this.require(errors, defaults.length <= 1, "EXISTING_MULTIPLE_DEFAULTS",
      "Sono presenti più workspace default.");
  },

  inspectExistingAliases(sheet, workspaces, errors) {
    const aliases = sheet.rows.map(row => this.normalize(row.values.Alias));
    const workspaceIds = workspaces.rows.map(row => String(row.values.ID || ""));
    this.require(errors, this.duplicates(aliases).length === 0,
      "EXISTING_ALIAS_DUPLICATE", "Alias esistenti duplicati.");
    sheet.rows.forEach(row => this.require(errors,
      workspaceIds.indexOf(String(row.values.WorkspaceID || "")) !== -1,
      "EXISTING_ALIAS_ORPHAN", "Alias esistente verso workspace inesistente."));
  },

  duplicates(values) {
    const seen = {};
    return values.filter(value => {
      const key = String(value);
      if (seen[key]) return true;
      seen[key] = true;
      return false;
    });
  },

  normalize(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
  },

  require(errors, condition, code, message) {
    if (!condition) errors.push({ code: code, message: message });
  }
};
