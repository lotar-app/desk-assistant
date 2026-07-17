const WorkspaceService = {

  list(options) {
    options = options || {};
    const workspaces = WorkspaceRepository.listAll();
    return options.includeDisabled
      ? workspaces
      : workspaces.filter(workspace => workspace.status === CONFIG.WORKSPACE_STATUS.ACTIVE);
  },

  getDefault() {
    const defaults = this.list().filter(workspace => workspace.isDefault);
    if (defaults.length > 1) {
      throw new Error("Configurazione non valida: più workspace predefiniti attivi.");
    }
    return defaults.length === 1 ? defaults[0] : null;
  },

  resolve(value, options) {
    const lookup = workspaceLookupKey(value);
    if (!lookup) {
      return null;
    }
    const workspaces = this.list(options);
    const byIdOrName = workspaces.find(workspace => (
      workspaceLookupKey(workspace.id) === lookup ||
      workspaceLookupKey(workspace.name) === lookup
    ));
    if (byIdOrName) {
      return byIdOrName;
    }
    const alias = WorkspaceAliasRepository.listAll().find(item => (
      workspaceLookupKey(item.alias) === lookup
    ));
    return alias
      ? workspaces.find(workspace => workspace.id === alias.workspaceId) || null
      : null;
  },

  resolveForAssignment(value) {
    const workspace = value
      ? this.resolve(value)
      : this.getDefault();
    if (!workspace) {
      throw new Error(value
        ? "Workspace non trovato o disattivato."
        : "Workspace predefinito non configurato.");
    }
    return workspace;
  },

  create(name, aliases) {
    const cleanName = String(name || "").trim();
    if (!cleanName) {
      throw new Error("Nome workspace non valido.");
    }
    const lock = this.documentLock();
    if (!lock.tryLock(30000)) {
      throw new Error("Impossibile acquisire il lock dei workspace.");
    }
    try {
      this.assertAvailableLabels([cleanName].concat(aliases || []));
      const now = new Date();
      const existingWorkspaces = WorkspaceRepository.listAll();
      const workspace = {
        id: this.nextId(existingWorkspaces),
        name: cleanName,
        isDefault: existingWorkspaces.length === 0,
        status: CONFIG.WORKSPACE_STATUS.ACTIVE,
        createdAt: now,
        updatedAt: now
      };
      WorkspaceRepository.append(workspace);
      (aliases || []).forEach(alias => this.addAlias(workspace.id, alias, now));
      return WorkspaceRepository.getById(workspace.id);
    } finally {
      lock.releaseLock();
    }
  },

  nextId(workspaces) {
    const maximum = (workspaces || []).reduce((max, workspace) => {
      const match = /^WS(\d{4,})$/.exec(String(workspace.id || ""));
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    return "WS" + String(maximum + 1).padStart(4, "0");
  },

  addAlias(workspaceId, alias, createdAt) {
    const workspace = this.resolveForAssignment(workspaceId);
    const cleanAlias = String(alias || "").trim();
    if (!cleanAlias) {
      throw new Error("Alias workspace non valido.");
    }
    const aliasKey = workspaceLookupKey(cleanAlias);
    const alreadyAvailable = workspaceLookupKey(workspace.name) === aliasKey ||
      WorkspaceAliasRepository.listAll().some(item => (
        item.workspaceId === workspace.id &&
        workspaceLookupKey(item.alias) === aliasKey
      ));
    if (alreadyAvailable) {
      return;
    }
    this.assertAvailableLabels([cleanAlias], workspace.id);
    WorkspaceAliasRepository.append({
      alias: cleanAlias,
      workspaceId: workspace.id,
      createdAt: createdAt || new Date()
    });
  },

  rename(workspaceId, name, options) {
    const cleanName = String(name || "").trim();
    if (!cleanName) {
      throw new Error("Nome workspace non valido.");
    }
    const lock = this.documentLock();
    if (!lock.tryLock(30000)) {
      throw new Error("Impossibile acquisire il lock dei workspace.");
    }
    try {
      const workspace = this.resolveForAssignment(workspaceId);
      this.assertAvailableLabels([cleanName], workspace.id);
      const previousName = workspace.name;
      const previousUpdatedAt = workspace.updatedAt;
      const updated = WorkspaceRepository.update(workspace.id, {
        name: cleanName,
        updatedAt: new Date()
      });
      try {
        if (!options || options.keepPreviousAsAlias !== false) {
          if (workspaceLookupKey(previousName) !== workspaceLookupKey(cleanName)) {
            this.addAlias(updated.id, previousName);
          }
        }
      } catch (error) {
        WorkspaceRepository.update(workspace.id, {
          name: previousName,
          updatedAt: previousUpdatedAt
        });
        throw error;
      }
      return updated;
    } finally {
      lock.releaseLock();
    }
  },

  setDefault(workspaceId) {
    const target = this.resolveForAssignment(workspaceId);
    const lock = this.documentLock();
    if (!lock.tryLock(30000)) {
      throw new Error("Impossibile acquisire il lock dei workspace.");
    }
    try {
      WorkspaceRepository.listAll().forEach(workspace => {
        if (workspace.isDefault !== (workspace.id === target.id)) {
          WorkspaceRepository.update(workspace.id, {
            isDefault: workspace.id === target.id,
            updatedAt: new Date()
          });
        }
      });
      return WorkspaceRepository.getById(target.id);
    } finally {
      lock.releaseLock();
    }
  },

  disable(workspaceId) {
    const workspace = this.resolveForAssignment(workspaceId);
    if (workspace.isDefault) {
      throw new Error("Il workspace predefinito non può essere disattivato.");
    }
    const projectIds = ProjectRepository.listAll()
      .filter(project => WorkspaceSettings.normalize(project.workspaceId) === workspace.id)
      .map(project => String(project.id));
    if (projectIds.length) {
      throw new Error(
        "Il workspace contiene progetti; spostarli o usare il merge prima di disattivarlo."
      );
    }
    return WorkspaceRepository.update(workspace.id, {
      status: CONFIG.WORKSPACE_STATUS.DISABLED,
      updatedAt: new Date()
    });
  },

  assignProject(projectId, workspaceId) {
    const project = ProjectRepository.getById(projectId);
    if (!project) {
      throw new Error("Progetto non trovato.");
    }
    const workspace = this.resolveForAssignment(workspaceId);
    ProjectRepository.update(projectId, {
      focus: project.focus,
      nextAction: project.nextAction,
      updatedAt: new Date(),
      workspaceId: workspace.id
    });
    return ProjectService.get(projectId);
  },

  merge(sourceWorkspaceId, targetWorkspaceId) {
    const source = this.resolveForAssignment(sourceWorkspaceId);
    const target = this.resolveForAssignment(targetWorkspaceId);
    if (source.id === target.id) {
      throw new Error("Workspace sorgente e destinazione coincidono.");
    }
    if (source.isDefault) {
      throw new Error("Il workspace predefinito non può essere assorbito.");
    }
    const lock = this.documentLock();
    if (!lock.tryLock(30000)) {
      throw new Error("Impossibile acquisire il lock dei workspace.");
    }
    try {
      const sourceName = source.name;
      const projects = ProjectRepository.listAll().filter(project => (
        WorkspaceSettings.normalize(project.workspaceId) === source.id
      ));
      projects.forEach(project => this.assignProject(project.id, target.id));
      WorkspaceRepository.update(source.id, {
        name: "Merged " + source.id + " - " + sourceName,
        isDefault: false,
        status: CONFIG.WORKSPACE_STATUS.DISABLED,
        updatedAt: new Date()
      });
      WorkspaceAliasRepository.move(source.id, target.id);
      if (workspaceLookupKey(sourceName) !== workspaceLookupKey(target.name)) {
        this.addAlias(target.id, sourceName);
      }
      return {
        sourceWorkspaceId: source.id,
        targetWorkspaceId: target.id,
        movedProjectIds: projects.map(project => String(project.id)),
        sourceStatus: CONFIG.WORKSPACE_STATUS.DISABLED
      };
    } finally {
      lock.releaseLock();
    }
  },

  listWithCounts() {
    const projects = ProjectRepository.listAll();
    return this.list({ includeDisabled: true }).map(workspace => Object.assign({}, workspace, {
      projectCount: projects.filter(project => (
        WorkspaceSettings.normalize(project.workspaceId) === workspace.id
      )).length
    }));
  },

  assertAvailableLabels(labels, ignoredWorkspaceId) {
    const ignored = WorkspaceSettings.normalize(ignoredWorkspaceId);
    const occupied = {};
    this.list({ includeDisabled: true }).forEach(workspace => {
      if (workspace.id !== ignored) {
        occupied[workspaceLookupKey(workspace.name)] = workspace.id;
      }
    });
    WorkspaceAliasRepository.listAll().forEach(alias => {
      if (alias.workspaceId !== ignored) {
        occupied[workspaceLookupKey(alias.alias)] = alias.workspaceId;
      }
    });
    const requested = {};
    (labels || []).forEach(label => {
      const key = workspaceLookupKey(label);
      if (!key || occupied[key] || requested[key]) {
        throw new Error("Nome o alias workspace già utilizzato: " + label);
      }
      requested[key] = true;
    });
  },

  documentLock() {
    return LockService.getDocumentLock();
  }
};

function workspaceLookupKey(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}
