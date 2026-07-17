/**
 * WORKSPACE SETTINGS
 *
 * Risolve il contesto operativo senza introdurre utenti o autorizzazioni.
 */

const WorkspaceSettings = {

  normalize(workspace) {
    const value = String(workspace === undefined || workspace === null
      ? ""
      : workspace).trim();
    return value ? value.toUpperCase() : "";
  }

};
