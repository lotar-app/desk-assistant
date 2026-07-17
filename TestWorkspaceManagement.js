function testWorkspaceManagement() {
  const originals = {
    workspaceListAll: WorkspaceRepository.listAll,
    workspaceGetById: WorkspaceRepository.getById,
    workspaceAppend: WorkspaceRepository.append,
    workspaceUpdate: WorkspaceRepository.update,
    aliasListAll: WorkspaceAliasRepository.listAll,
    aliasAppend: WorkspaceAliasRepository.append,
    aliasMove: WorkspaceAliasRepository.move,
    projectListAll: ProjectRepository.listAll,
    projectGetById: ProjectRepository.getById,
    projectUpdate: ProjectRepository.update,
    projectServiceGet: ProjectService.get,
    taskList: TaskRepository.list,
    timelineList: TimelineRepository.list,
    documentLock: WorkspaceService.documentLock
  };
  const workspaces = [
    workspaceManagementWorkspace("WS0001", "Lotar", true),
    workspaceManagementWorkspace("WS0002", "TuscanPledges", false),
    workspaceManagementWorkspace("WS0003", "Tuscanpledges", false)
  ];
  const aliases = [{
    alias: "TP",
    workspaceId: "WS0002",
    createdAt: new Date()
  }];
  const projects = [
    workspaceManagementProject("PRJ-LOTAR", "WS0001"),
    workspaceManagementProject("PRJ-TP", "WS0002"),
    workspaceManagementProject("PRJ-NONE", "")
  ];
  const lock = {
    acquired: 0,
    released: 0,
    tryLock() { this.acquired++; return true; },
    releaseLock() { this.released++; }
  };

  try {
    WorkspaceRepository.listAll = function() { return workspaces; };
    WorkspaceRepository.getById = function(id) {
      return workspaces.find(workspace => workspace.id === id) || null;
    };
    WorkspaceRepository.append = function(workspace) { workspaces.push(workspace); };
    WorkspaceRepository.update = function(id, changes) {
      const workspace = workspaces.find(item => item.id === id);
      Object.assign(workspace, changes || {});
      return workspace;
    };
    WorkspaceAliasRepository.listAll = function() { return aliases; };
    WorkspaceAliasRepository.append = function(alias) { aliases.push(alias); };
    WorkspaceAliasRepository.move = function(sourceId, targetId) {
      aliases.forEach(alias => {
        if (alias.workspaceId === sourceId) alias.workspaceId = targetId;
      });
    };
    ProjectRepository.listAll = function() { return projects; };
    ProjectRepository.getById = function(id) {
      return projects.find(project => project.id === id) || null;
    };
    ProjectRepository.update = function(id, changes) {
      const project = projects.find(item => item.id === id);
      Object.assign(project, changes || {});
      return true;
    };
    ProjectService.get = function(id) { return ProjectRepository.getById(id); };
    TaskRepository.list = function() {
      return [
        { id: "TSK-VALID", projectId: "PRJ-LOTAR" },
        { id: "TSK-ORPHAN", projectId: "PRJ-MISSING" }
      ];
    };
    TimelineRepository.list = function() {
      return [
        { projectId: "PRJ-TP", date: new Date(), type: "UPDATE" },
        { projectId: "PRJ-MISSING", date: new Date(), type: "UPDATE" }
      ];
    };
    WorkspaceService.documentLock = function() { return lock; };

    assertWorkspaceManagement(
      WorkspaceSettings.normalize("") === "",
      "Un workspace mancante viene ancora convertito nel default."
    );
    assertWorkspaceManagement(
      WorkspaceService.nextId(workspaces) === "WS0004",
      "La generazione dell'ID progressivo non è stabile."
    );
    assertWorkspaceManagement(
      WorkspaceService.resolve("TP").id === "WS0002",
      "La risoluzione per alias non funziona."
    );

    workspaces[1].isDefault = true;
    let multipleDefaultsRejected = false;
    try {
      WorkspaceService.getDefault();
    } catch (error) {
      multipleDefaultsRejected = error.message.indexOf("più workspace") !== -1;
    }
    workspaces[1].isDefault = false;
    assertWorkspaceManagement(
      multipleDefaultsRejected,
      "Più workspace predefiniti vengono selezionati arbitrariamente."
    );

    const created = WorkspaceService.create("Internal", ["Ops"]);
    const empty = WorkspaceService.create("Empty", []);
    assertWorkspaceManagement(
      created.id === "WS0004" &&
      WorkspaceService.resolve("Ops").id === "WS0004" &&
      empty.id === "WS0005",
      "Creazione, ID progressivo o alias del workspace non validi."
    );
    WorkspaceService.setDefault(created.id);
    assertWorkspaceManagement(
      WorkspaceService.getDefault().id === "WS0004" && !workspaces[0].isDefault,
      "Il cambio del workspace predefinito non è coerente."
    );
    WorkspaceService.disable(empty.id);
    assertWorkspaceManagement(
      WorkspaceRepository.getById(empty.id).status ===
        CONFIG.WORKSPACE_STATUS.DISABLED,
      "Un workspace vuoto non viene disattivato correttamente."
    );

    const merge = WorkspaceService.merge("WS0002", "WS0003");
    assertWorkspaceManagement(
      merge.movedProjectIds.join(",") === "PRJ-TP" &&
      projects[1].workspaceId === "WS0003" &&
      TimelineRepository.list()[0].projectId === "PRJ-TP",
      "Il merge non sposta i progetti mantenendone gli ID."
    );
    assertWorkspaceManagement(
      workspaces[1].status === CONFIG.WORKSPACE_STATUS.DISABLED,
      "Il merge non disattiva il workspace sorgente."
    );
    assertWorkspaceManagement(
      WorkspaceService.resolve("TP").id === "WS0003" &&
      WorkspaceService.resolve("TuscanPledges").id === "WS0003",
      "Il merge non preserva alias e nome storico."
    );

    const renamed = WorkspaceService.rename(
      "WS0003",
      "Tuscan Pledges",
      { keepPreviousAsAlias: true }
    );
    assertWorkspaceManagement(
      renamed.id === "WS0003" && renamed.name === "Tuscan Pledges" &&
      WorkspaceService.resolve("Tuscanpledges").id === "WS0003",
      "La rinomina cambia identità o perde il nome precedente."
    );

    WorkspaceService.assignProject("PRJ-NONE", "WS0001");
    assertWorkspaceManagement(
      projects[2].workspaceId === "WS0001",
      "L'assegnazione di un progetto non classificato non funziona."
    );

    projects.push(workspaceManagementProject("PRJ-UNCLASSIFIED", ""));
    const quality = WorkspaceDataQualityService.inspect();
    assertWorkspaceManagement(
      quality.projectsWithoutWorkspace[0].projectId === "PRJ-UNCLASSIFIED" &&
      quality.orphanTaskIds[0] === "TSK-ORPHAN" &&
      quality.orphanTimeline.length === 1,
      "La diagnostica Workspace non segnala dati mancanti od orfani."
    );

    const migrationPlan = WorkspaceMigration.plan({
      "PRJ-UNCLASSIFIED": "WS0001"
    });
    const migrationOperations = WorkspaceMigration.operations({
      "PRJ-UNCLASSIFIED": "WS0001"
    });
    assertWorkspaceManagement(
      migrationPlan.valid && migrationPlan.assignments.length === 1 &&
      migrationPlan.assignments[0].projectId === "PRJ-UNCLASSIFIED" &&
      migrationPlan.projectsToClassify.length === 3 &&
      migrationOperations.length === 1 &&
      migrationOperations[0].selector.ID === "PRJ-UNCLASSIFIED" &&
      migrationOperations[0].after.WorkspaceID === "WS0001",
      "La migrazione non usa esclusivamente il mapping esplicito."
    );

    return {
      success: true,
      movedProjects: merge.movedProjectIds.length,
      aliases: aliases.length,
      projectsWithoutWorkspace: quality.projectsWithoutWorkspace.length,
      lockAcquired: lock.acquired,
      lockReleased: lock.released
    };
  } finally {
    WorkspaceRepository.listAll = originals.workspaceListAll;
    WorkspaceRepository.getById = originals.workspaceGetById;
    WorkspaceRepository.append = originals.workspaceAppend;
    WorkspaceRepository.update = originals.workspaceUpdate;
    WorkspaceAliasRepository.listAll = originals.aliasListAll;
    WorkspaceAliasRepository.append = originals.aliasAppend;
    WorkspaceAliasRepository.move = originals.aliasMove;
    ProjectRepository.listAll = originals.projectListAll;
    ProjectRepository.getById = originals.projectGetById;
    ProjectRepository.update = originals.projectUpdate;
    ProjectService.get = originals.projectServiceGet;
    TaskRepository.list = originals.taskList;
    TimelineRepository.list = originals.timelineList;
    WorkspaceService.documentLock = originals.documentLock;
  }
}

function workspaceManagementWorkspace(id, name, isDefault) {
  return {
    id: id,
    name: name,
    isDefault: isDefault,
    status: CONFIG.WORKSPACE_STATUS.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

function workspaceManagementProject(id, workspaceId) {
  return {
    id: id,
    name: id,
    status: CONFIG.PROJECT_STATUS.IN_PROGRESS,
    focus: "",
    nextAction: "",
    workspaceId: workspaceId
  };
}

function assertWorkspaceManagement(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
