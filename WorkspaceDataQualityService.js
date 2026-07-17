const WorkspaceDataQualityService = {

  inspect() {
    const projects = ProjectRepository.listAll();
    const workspaces = WorkspaceRepository.listAll();
    const aliases = WorkspaceAliasRepository.listAll();
    const tasks = TaskRepository.list();
    const timeline = TimelineRepository.list();
    const workspaceById = {};
    const projectById = {};

    workspaces.forEach(workspace => {
      workspaceById[workspace.id] = workspace;
    });
    projects.forEach(project => {
      projectById[String(project.id)] = project;
    });

    const labels = {};
    const collisions = [];
    workspaces.forEach(workspace => {
      this.recordLabel(labels, collisions, workspace.name, workspace.id, "NAME");
    });
    aliases.forEach(alias => {
      this.recordLabel(labels, collisions, alias.alias, alias.workspaceId, "ALIAS");
    });

    const defaultWorkspaces = workspaces.filter(workspace => (
      workspace.isDefault && workspace.status === CONFIG.WORKSPACE_STATUS.ACTIVE
    ));

    return {
      generatedAt: new Date().toISOString(),
      projectsWithoutWorkspace: projects
        .filter(project => !WorkspaceSettings.normalize(project.workspaceId))
        .map(workspaceDataQualityProject),
      projectsWithUnknownWorkspace: projects
        .filter(project => (
          !!WorkspaceSettings.normalize(project.workspaceId) &&
          !workspaceById[WorkspaceSettings.normalize(project.workspaceId)]
        ))
        .map(workspaceDataQualityProject),
      workspacesWithoutProjects: workspaces
        .filter(workspace => !projects.some(project => (
          WorkspaceSettings.normalize(project.workspaceId) === workspace.id
        )))
        .map(workspace => ({
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          status: workspace.status
        })),
      defaultWorkspaceIssue: defaultWorkspaces.length === 1
        ? null
        : {
          expected: 1,
          actual: defaultWorkspaces.length,
          workspaceIds: defaultWorkspaces.map(workspace => workspace.id)
        },
      labelCollisions: collisions,
      invalidWorkspaceIds: workspaces
        .filter(workspace => !/^WS\d{4,}$/.test(workspace.id))
        .map(workspace => workspace.id),
      aliasesWithUnknownWorkspace: aliases
        .filter(alias => !workspaceById[alias.workspaceId])
        .map(alias => ({ alias: alias.alias, workspaceId: alias.workspaceId })),
      orphanTaskIds: tasks
        .filter(task => !projectById[String(task.projectId)])
        .map(task => String(task.id)),
      orphanTimeline: timeline
        .filter(event => !projectById[String(event.projectId)])
        .map(event => ({
          projectId: String(event.projectId),
          date: event.date,
          type: event.type
        }))
    };
  },

  recordLabel(labels, collisions, label, workspaceId, type) {
    const key = workspaceLookupKey(label);
    if (!key) {
      return;
    }
    if (labels[key]) {
      collisions.push({
        label: label,
        first: labels[key],
        second: { workspaceId: workspaceId, type: type }
      });
      return;
    }
    labels[key] = { workspaceId: workspaceId, type: type };
  }
};

function workspaceDataQualityProject(project) {
  return {
    projectId: String(project.id),
    projectName: String(project.name || ""),
    workspaceId: WorkspaceSettings.normalize(project.workspaceId)
  };
}
