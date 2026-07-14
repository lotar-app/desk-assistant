/**
 * MEMORY UPDATE
 *
 * Contratto dati per un aggiornamento preparato dall'assistente.
 * Non salva dati e non conosce DeskEngine, Service, Repository o Google Sheets.
 */

const MemoryUpdate = {

  create() {

    return {
      projectId: "",
      summary: "",
      focus: null,
      nextAction: null,
      status: null,
      newTasks: [],
      completedTasks: [],
      timelineEvent: null,
      confidence: 1.0,
      needsConfirmation: false
    };

  },

  validate(update) {

    if (!update || typeof update !== "object") {
      throw new Error("MemoryUpdate non valido.");
    }

    if (!String(update.projectId || "").trim()) {
      throw new Error("MemoryUpdate.projectId obbligatorio.");
    }

    if (
      typeof update.confidence !== "number" ||
      update.confidence < 0 ||
      update.confidence > 1
    ) {
      throw new Error("MemoryUpdate.confidence deve essere compresa tra 0 e 1.");
    }

    if (!Array.isArray(update.newTasks)) {
      throw new Error("MemoryUpdate.newTasks deve essere un array.");
    }

    if (!Array.isArray(update.completedTasks)) {
      throw new Error("MemoryUpdate.completedTasks deve essere un array.");
    }

    return true;

  }

};
