/**
 * CONVERSATION ENGINE
 *
 * Entry point degli aggiornamenti provenienti dalla conversazione.
 */

const ConversationEngine = {

  getWorkspaceBriefing(workspace) {

    return {
      success: true,
      briefing: DeskEngine.getWorkspaceBriefing(workspace)
    };

  },

  getProject(projectName) {

    const name = String(projectName || "").trim();

    if (!name) {
      throw new Error("Nome progetto non valido.");
    }

    const project = ProjectService.findByName(name);

    if (!project) {
      return {
        success: false,
        error: "PROJECT_NOT_FOUND"
      };
    }

    return {
      success: true,
      project: project
    };

  },

  processConversationUpdate(projectName, conversationData) {

    const name = String(projectName || "").trim();

    if (!name) {
      throw new Error("Nome progetto non valido.");
    }

    let project = ProjectService.findByName(name);
    let projectCreated = false;

    if (!project) {
      const projectId = ProjectService.create(name);
      project = ProjectService.get(projectId);
      projectCreated = true;
    }

    const result = DeskEngine.applyConversationUpdate(
      project.id,
      conversationData
    );

    return {
      success: true,
      projectId: project.id,
      projectCreated: projectCreated,
      result: result
    };

  }

};
