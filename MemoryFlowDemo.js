/**
 * MEMORY FLOW DEMO
 *
 * Dimostra il ciclo:
 * MemoryUpdate -> prepareMemoryUpdate -> applyPreparedUpdate.
 */

function demoMemoryFlow() {

  const projects = DeskEngine.listProjects();

  if (!projects.length) {
    throw new Error("Nessun progetto disponibile per la demo.");
  }

  const update = MemoryUpdate.create();

  update.projectId = projects[0].id;
  update.summary = "Demo flusso MemoryUpdate completata.";
  update.nextAction = "Verificare il risultato della demo MemoryFlow.";
  update.timelineEvent = {
    type: "MEMORY_FLOW_DEMO",
    description: "Eseguita demo del flusso MemoryUpdate completo."
  };
  update.newTasks = [
    "Controllare il risultato della demo MemoryFlow"
  ];

  const prepared = DeskEngine.prepareMemoryUpdate(update);

  return DeskEngine.applyPreparedUpdate(prepared);

}
