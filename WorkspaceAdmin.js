function listWorkspaces() {
  return WorkspaceService.listWithCounts();
}

function createWorkspace(name, aliases) {
  return WorkspaceService.create(name, aliases || []);
}

function renameWorkspace(workspaceId, name, keepPreviousAsAlias) {
  return WorkspaceService.rename(workspaceId, name, {
    keepPreviousAsAlias: keepPreviousAsAlias !== false
  });
}

function setDefaultWorkspace(workspaceId) {
  return WorkspaceService.setDefault(workspaceId);
}

function disableWorkspace(workspaceId) {
  return WorkspaceService.disable(workspaceId);
}

function assignProjectWorkspace(projectId, workspaceId) {
  return WorkspaceService.assignProject(projectId, workspaceId);
}

function mergeWorkspaces(sourceWorkspaceId, targetWorkspaceId) {
  return WorkspaceService.merge(sourceWorkspaceId, targetWorkspaceId);
}

function inspectWorkspaceDataQuality() {
  return WorkspaceDataQualityService.inspect();
}
