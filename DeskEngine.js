/**
 * DESK ENGINE
 *
 * Orchestratore applicativo centrale.
 * Non contiene logica di persistenza e non accede direttamente a Google Sheets.
 */

const MAX_CONTEXT_PROJECTS = 5;

const DeskEngine = {

  listProjects(workspace) {
    return ProjectRepository
      .listByWorkspace(WorkspaceSettings.resolve(workspace))
      .map(project => ({
        id: project.id,
        name: project.name,
        workspace: project.workspace
      }));
  },

  getProject(projectId, workspace) {

    const project = ProjectService.get(projectId);

    if (!project) {
      throw new Error("Progetto non trovato.");
    }

    if (
      WorkspaceSettings.normalize(project.workspace) !==
      WorkspaceSettings.resolve(workspace)
    ) {
      throw new Error("Progetto non trovato nel workspace selezionato.");
    }

    return project;

  },

  getProjectBriefing(projectId, workspace) {

    if (!projectId) {
      throw new Error("Progetto non valido.");
    }

    const project = this.getProject(projectId, workspace);

    return {
      project: project,
      openTasks: this
        .listProjectTasks(projectId)
        .filter(task => !this.isTaskCompleted(task)),
      timeline: this.getRecentTimeline(projectId)
    };

  },

  listProjectTasks(projectId) {

    if (!projectId) {
      throw new Error("Progetto non valido.");
    }

    return TaskService.listByProject(projectId);

  },

  completeTask(taskId) {

    if (!taskId) {
      throw new Error("Attività non valida.");
    }

    return TaskService.complete(taskId);

  },

  saveProjectUpdate(payload) {

    if (!payload || !payload.id) {
      throw new Error("Payload non valido.");
    }

    const project = ProjectService.update(payload.id, {
      update: payload.update,
      focus: payload.focus,
      nextAction: payload.nextAction,
      status: payload.status
    });

    const taskTitle = String(payload.newTask || "").trim();

    if (taskTitle) {
      TaskService.create(payload.id, {
        title: taskTitle
      });
    }

    return project;

  },

  getRecentTimeline(projectId) {

    if (!projectId) {
      throw new Error("Progetto non valido.");
    }

    return getLatestTimeline(projectId, 5);

  },

  getWorkspaceBriefing(workspace) {

    const now = new Date();
    const today = workspaceDateKey(now);
    const selectedWorkspace = WorkspaceSettings.resolve(workspace);
    const allProjects = ProjectService.listAll();
    const projects = allProjects.filter(project => (
      WorkspaceSettings.normalize(project.workspace) === selectedWorkspace
    ));
    const openTasks = TaskService.listOpen();
    const timelineEvents = getTimelineEvents();
    const projectById = {};
    const allProjectById = {};
    const tasksByProject = {};
    const timelineByProject = {};

    allProjects.forEach(project => {
      allProjectById[String(project.id)] = project;
    });

    projects.forEach(project => {
      projectById[String(project.id)] = project;
      tasksByProject[String(project.id)] = [];
      timelineByProject[String(project.id)] = [];
    });

    openTasks.forEach(task => {
      const projectId = String(task.projectId);

      if (tasksByProject[projectId]) {
        tasksByProject[projectId].push(task);
      }
    });

    const workspaceOpenTasks = openTasks.filter(task => (
      !!projectById[String(task.projectId)]
    ));

    timelineEvents.forEach(event => {
      const projectId = String(event.projectId);

      if (timelineByProject[projectId]) {
        timelineByProject[projectId].push(event);
      }
    });

    Object.keys(timelineByProject).forEach(projectId => {
      timelineByProject[projectId].sort((a, b) => (
        workspaceTimeValue(b.date) - workspaceTimeValue(a.date)
      ));
    });

    const activeProjects = projects.filter(project => (
      project.status !== CONFIG.PROJECT_STATUS.COMPLETED
    ));
    const contexts = activeProjects.map(project => (
      workspaceProjectContext(
        project,
        tasksByProject[String(project.id)] || [],
        timelineByProject[String(project.id)] || []
      )
    ));

    contexts.sort((a, b) => (
      workspaceTimeValue(b.lastActivityAt) - workspaceTimeValue(a.lastActivityAt)
    ));

    const taskDetails = workspaceOpenTasks
      .filter(task => (
        !!projectById[String(task.projectId)] &&
        projectById[String(task.projectId)].status !== CONFIG.PROJECT_STATUS.COMPLETED
      ))
      .map(task => workspaceTaskDetail(
        task,
        projectById[String(task.projectId)],
        today
      ));
    const overdueTasks = taskDetails.filter(task => task.dueState === "OVERDUE");
    const dueTodayTasks = taskDetails.filter(task => task.dueState === "DUE_TODAY");
    const waitingProjects = contexts.filter(context => (
      context.status === CONFIG.PROJECT_STATUS.WAITING
    ));
    const blockedProjects = contexts.filter(context => (
      context.status === CONFIG.PROJECT_STATUS.BLOCKED
    ));
    const executableProjects = contexts.filter(context => (
      context.status !== CONFIG.PROJECT_STATUS.WAITING &&
      context.status !== CONFIG.PROJECT_STATUS.BLOCKED
    ));
    const recordedPriorities = taskDetails.filter(task => !!task.priority);
    const orphanTasks = openTasks.filter(task => (
      !allProjectById[String(task.projectId)]
    ));
    const tasksInCompletedProjects = workspaceOpenTasks.filter(task => (
      !!projectById[String(task.projectId)] &&
      projectById[String(task.projectId)].status === CONFIG.PROJECT_STATUS.COMPLETED
    ));

    return {
      generatedAt: now.toISOString(),
      workspace: selectedWorkspace,
      date: today,
      timezone: Session.getScriptTimeZone(),
      counts: {
        projects: projects.length,
        activeProjects: activeProjects.length,
        waitingProjects: waitingProjects.length,
        blockedProjects: blockedProjects.length,
        openTasks: workspaceOpenTasks.length,
        overdueTasks: overdueTasks.length,
        dueTodayTasks: dueTodayTasks.length
      },
      recentContext: contexts.slice(0, MAX_CONTEXT_PROJECTS),
      attentionSignals: {
        overdueTasks: overdueTasks,
        dueTodayTasks: dueTodayTasks,
        blockedProjects: blockedProjects.map(workspaceProjectSummary),
        projectsWithoutNextAction: activeProjects
          .filter(project => !String(project.nextAction || "").trim())
          .map(workspaceProjectSummary)
      },
      recordedPriorities: recordedPriorities.map(task => ({
        taskId: task.taskId,
        projectId: task.projectId,
        projectName: task.projectName,
        title: task.title,
        priority: task.priority,
        dueDate: task.dueDate
      })),
      availableNextActions: executableProjects
        .filter(context => !!context.nextAction)
        .map(context => ({
          projectId: context.projectId,
          projectName: context.projectName,
          nextAction: context.nextAction,
          updatedAt: context.updatedAt,
          lastEvent: context.lastEvent
        })),
      waitingContext: waitingProjects,
      candidateStartingPoints: workspaceCandidateStartingPoints(
        taskDetails,
        executableProjects
      ),
      dataQuality: {
        projectsWithoutFocus: activeProjects
          .filter(project => !String(project.focus || "").trim())
          .map(workspaceProjectSummary),
        projectsWithoutNextAction: activeProjects
          .filter(project => !String(project.nextAction || "").trim())
          .map(workspaceProjectSummary),
        tasksWithInvalidDueDate: taskDetails
          .filter(task => task.dueState === "INVALID")
          .map(task => task.taskId),
        orphanTaskIds: orphanTasks.map(task => task.id),
        openTaskIdsInCompletedProjects: tasksInCompletedProjects.map(task => task.id),
        projectsWithoutTimeline: activeProjects
          .filter(project => !timelineByProject[String(project.id)].length)
          .map(workspaceProjectSummary)
      }
    };

  },

  prepareMemoryUpdate(memoryUpdate) {

    MemoryUpdate.validate(memoryUpdate);

    return {
      valid: true,
      update: memoryUpdate,
      preview: {
        projectId: memoryUpdate.projectId,
        summary: memoryUpdate.summary,
        newTasks: memoryUpdate.newTasks,
        completedTasks: memoryUpdate.completedTasks,
        status: memoryUpdate.status
      }
    };

  },

  applyPreparedUpdate(preparedUpdate) {

    if (!preparedUpdate || preparedUpdate.valid !== true || !preparedUpdate.update) {
      throw new Error("PreparedUpdate non valido.");
    }

    const memoryUpdate = preparedUpdate.update;

    MemoryUpdate.validate(memoryUpdate);

    const projectId = memoryUpdate.projectId;
    const project = this.getProject(projectId);
    const createdTasks = [];
    const updatedTasks = [];

    if (this.hasProjectUpdate(memoryUpdate)) {
      ProjectService.update(projectId, {
        update: String(memoryUpdate.summary || ""),
        focus: memoryUpdate.focus !== null ? memoryUpdate.focus : project.focus,
        nextAction: memoryUpdate.nextAction !== null
          ? memoryUpdate.nextAction
          : project.nextAction,
        status: memoryUpdate.status !== null ? memoryUpdate.status : project.status
      });
    }

    memoryUpdate.newTasks.forEach(task => {

      const taskData = this.toTaskData(task);

      if (taskData) {
        createdTasks.push(TaskService.create(projectId, taskData));
      }

    });

    memoryUpdate.completedTasks.forEach(task => {

      const taskId = this.toTaskId(task);

      if (taskId) {
        updatedTasks.push(this.completeTask(taskId));
      }

    });

    if (memoryUpdate.timelineEvent !== null) {
      addTimeline(
        projectId,
        this.toTimelineType(memoryUpdate.timelineEvent),
        this.toTimelineText(memoryUpdate.timelineEvent)
      );
    }

    return {
      success: true,
      projectId: projectId,
      updatedTasks: updatedTasks,
      createdTasks: createdTasks
    };

  },

  applyConversationUpdate(projectId, updateData) {

    if (!updateData || typeof updateData !== "object") {
      throw new Error("Payload conversazione non valido.");
    }

    const memoryUpdate = MemoryUpdate.create();

    memoryUpdate.projectId = projectId;
    memoryUpdate.summary = String(updateData.summary || "");
    memoryUpdate.focus = updateData.focus !== undefined ? updateData.focus : null;
    memoryUpdate.nextAction = updateData.nextAction !== undefined
      ? updateData.nextAction
      : null;
    memoryUpdate.status = updateData.status !== undefined
      ? updateData.status
      : null;
    memoryUpdate.newTasks = Array.isArray(updateData.newTasks)
      ? updateData.newTasks
      : [];
    memoryUpdate.completedTasks = Array.isArray(updateData.completedTasks)
      ? updateData.completedTasks
      : [];
    memoryUpdate.timelineEvent = updateData.timelineEvent !== undefined
      ? updateData.timelineEvent
      : null;

    if (typeof updateData.confidence === "number") {
      memoryUpdate.confidence = updateData.confidence;
    }

    if (typeof updateData.needsConfirmation === "boolean") {
      memoryUpdate.needsConfirmation = updateData.needsConfirmation;
    }

    const prepared = this.prepareMemoryUpdate(memoryUpdate);

    return this.applyPreparedUpdate(prepared);

  },

  hasProjectUpdate(memoryUpdate) {

    return (
      memoryUpdate.summary ||
      memoryUpdate.focus !== null ||
      memoryUpdate.nextAction !== null ||
      memoryUpdate.status !== null
    );

  },

  toTaskData(task) {

    if (typeof task === "string") {
      const title = task.trim();
      return title ? { title: title } : null;
    }

    if (!task || typeof task !== "object") {
      return null;
    }

    const title = String(task.title || task.name || "").trim();

    if (!title) {
      return null;
    }

    return {
      title: title,
      description: task.description || "",
      priority: task.priority,
      assignee: task.assignee,
      dueDate: task.dueDate
    };

  },

  toTaskId(task) {

    if (typeof task === "string") {
      return task.trim();
    }

    if (!task || typeof task !== "object") {
      return "";
    }

    return String(task.id || task.taskId || "").trim();

  },

  toTimelineType(timelineEvent) {

    if (!timelineEvent || typeof timelineEvent !== "object") {
      return "MEMORY_UPDATE";
    }

    return String(timelineEvent.type || "MEMORY_UPDATE");

  },

  toTimelineText(timelineEvent) {

    if (typeof timelineEvent === "string") {
      return timelineEvent;
    }

    if (!timelineEvent || typeof timelineEvent !== "object") {
      return "";
    }

    return String(
      timelineEvent.description ||
      timelineEvent.text ||
      timelineEvent.summary ||
      ""
    );

  },

  isTaskCompleted(task) {
    return task.status === CONFIG.TASK_STATUS.COMPLETED || !!task.completedAt;
  }

};

function workspaceProjectContext(project, tasks, events) {

  const recentEvents = events.slice(0, 3).map(workspaceTimelineDetail);
  const updatedAt = workspaceDateValue(project.updatedAt);
  const lastEventAt = recentEvents.length ? recentEvents[0].date : "";
  const lastActivityAt = workspaceTimeValue(lastEventAt) > workspaceTimeValue(updatedAt)
    ? lastEventAt
    : updatedAt;

  return {
    projectId: String(project.id),
    projectName: String(project.name || ""),
    workspace: WorkspaceSettings.normalize(project.workspace),
    status: project.status,
    focus: String(project.focus || ""),
    nextAction: String(project.nextAction || ""),
    owner: String(project.owner || ""),
    updatedAt: updatedAt,
    lastActivityAt: lastActivityAt,
    daysSinceLastActivity: workspaceDaysSince(lastActivityAt),
    openTaskCount: tasks.length,
    openTasks: tasks.slice(0, 5).map(task => ({
      taskId: String(task.id),
      title: String(task.title || ""),
      priority: String(task.priority || ""),
      dueDate: workspaceDateValue(task.dueDate)
    })),
    lastEvent: recentEvents.length ? recentEvents[0] : null,
    recentEvents: recentEvents
  };

}

function workspaceTaskDetail(task, project, today) {

  const dueDate = workspaceDateValue(task.dueDate);
  const dueKey = workspaceDateKey(task.dueDate);
  let dueState = "NONE";

  if (task.dueDate && !dueKey) {
    dueState = "INVALID";
  } else if (dueKey && dueKey < today) {
    dueState = "OVERDUE";
  } else if (dueKey && dueKey === today) {
    dueState = "DUE_TODAY";
  } else if (dueKey) {
    dueState = "UPCOMING";
  }

  return {
    taskId: String(task.id),
    projectId: String(project.id),
    projectName: String(project.name || ""),
    projectStatus: project.status,
    title: String(task.title || ""),
    description: String(task.description || ""),
    priority: String(task.priority || ""),
    dueDate: dueDate,
    dueState: dueState,
    updatedAt: workspaceDateValue(task.updatedAt)
  };

}

function workspaceCandidateStartingPoints(tasks, projects) {

  const candidates = [];

  tasks.forEach(task => {

    if (
      task.projectStatus === CONFIG.PROJECT_STATUS.WAITING ||
      task.projectStatus === CONFIG.PROJECT_STATUS.BLOCKED ||
      task.projectStatus === CONFIG.PROJECT_STATUS.COMPLETED
    ) {
      return;
    }

    const signals = [];

    if (task.dueState === "OVERDUE") {
      signals.push("OVERDUE");
    }

    if (task.dueState === "DUE_TODAY") {
      signals.push("DUE_TODAY");
    }

    if (
      task.priority &&
      task.priority !== CONFIG.TASK_PRIORITY.NORMAL
    ) {
      signals.push("RECORDED_PRIORITY");
    }

    if (signals.length) {
      candidates.push({
        type: "TASK",
        projectId: task.projectId,
        projectName: task.projectName,
        taskId: task.taskId,
        title: task.title,
        signals: signals,
        reason: signals.map(signal => ({
          OVERDUE: "Task scaduta",
          DUE_TODAY: "Task in scadenza oggi",
          RECORDED_PRIORITY: "Priorità registrata"
        })[signal]).join("; ")
      });
    }
  });

  projects.forEach(project => {
    if (project.nextAction) {
      candidates.push({
        type: "NEXT_ACTION",
        projectId: project.projectId,
        projectName: project.projectName,
        nextAction: project.nextAction,
        signals: ["RECORDED_NEXT_ACTION"],
        reason: "Prossima azione registrata"
      });
    }
  });

  return candidates.slice(0, 20);

}

function workspaceProjectSummary(project) {

  return {
    projectId: String(project.projectId || project.id),
    projectName: String(project.projectName || project.name || ""),
    status: project.status,
    focus: String(project.focus || ""),
    nextAction: String(project.nextAction || ""),
    updatedAt: workspaceDateValue(project.updatedAt)
  };

}

function workspaceTimelineDetail(event) {

  return {
    date: workspaceDateValue(event.date),
    type: String(event.type || ""),
    description: String(event.description || "")
  };

}

function workspaceDateValue(value) {

  if (!value) {
    return "";
  }

  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString();
  }

  const text = String(value).trim();
  const italianDate = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (italianDate) {
    return new Date(Date.UTC(
      Number(italianDate[3]),
      Number(italianDate[2]) - 1,
      Number(italianDate[1])
    )).toISOString();
  }

  const parsed = new Date(text);

  return isNaN(parsed.getTime()) ? "" : parsed.toISOString();

}

function workspaceDateKey(value) {

  if (!value) {
    return "";
  }

  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(
      value,
      Session.getScriptTimeZone(),
      "yyyy-MM-dd"
    );
  }

  const text = String(value).trim();
  const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (isoDate) {
    return isoDate[1] + "-" + isoDate[2] + "-" + isoDate[3];
  }

  const italianDate = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (italianDate) {
    return italianDate[3] + "-" +
      italianDate[2].padStart(2, "0") + "-" +
      italianDate[1].padStart(2, "0");
  }

  const parsed = new Date(text);

  if (isNaN(parsed.getTime())) {
    return "";
  }

  return Utilities.formatDate(
    parsed,
    Session.getScriptTimeZone(),
    "yyyy-MM-dd"
  );

}

function workspaceTimeValue(value) {

  if (!value) {
    return 0;
  }

  const date = value instanceof Date ? value : new Date(value);

  return isNaN(date.getTime()) ? 0 : date.getTime();

}

function workspaceDaysSince(value) {

  const timestamp = workspaceTimeValue(value);

  if (!timestamp) {
    return null;
  }

  return Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));

}
