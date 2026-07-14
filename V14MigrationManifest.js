function createV14DataFoundationManifest() {

  const operations = [];

  function add(operationId, action, sheet, selector, after, reason) {
    operations.push({
      operationId: operationId,
      action: action,
      sheet: sheet,
      selector: selector,
      after: after || null,
      reason: reason
    });
  }

  const testProjectIds = [
    "PRJ-20260708-090927",
    "PRJ-20260708091734",
    "PRJ-20260708092355",
    "PRJ-20260708093126",
    "PRJ-20260708094055",
    "PRJ-20260709135856",
    "PRJ-20260710094827"
  ];

  testProjectIds.forEach((projectId, index) => {
    add(
      "V14-DELETE-TEST-PROJECT-" + (index + 1),
      "DELETE",
      "Projects",
      { ID: projectId },
      null,
      "Rimozione progetto di test approvata dall'audit."
    );
  });

  [
    "TSK-20260708123408",
    "TSK-20260708124016",
    "TSK-20260708124958",
    "TSK-20260709104710",
    "TSK-20260709113435"
  ].forEach((taskId, index) => {
    add(
      "V14-DELETE-TASK-" + (index + 1),
      "DELETE",
      "Tasks",
      { ID: taskId },
      null,
      "Rimozione task di test, tecnica o duplicata approvata dall'audit."
    );
  });

  const timelineDeletes = [
    [2, "PRJ-20260708092355", "PROJECT_CREATED", "Progetto creato"],
    [3, "PRJ-20260708094055", "PROJECT_CREATED", "Progetto creato"],
    [4, "PRJ-20260708091734", "PROJECT_UPDATED", "prova aggiornamento"],
    [5, "PRJ-20260708092355", "TASK_CREATED", "Creata attività: Task di test"],
    [6, "PRJ-20260708092355", "TASK_CREATED", "Creata attività: Seconda task di prova"],
    [7, "PRJ-20260708-090927", "TASK_CREATED", "Creata attività: Telefonare al cliente"],
    [8, "PRJ-20260708-090927", "TASK_COMPLETED", "Completata attività: Telefonare al cliente"],
    [21, "PRJ-20260709095234", "PROJECT_UPDATED", "Aggiornamento pagina Cucine d'Autore."],
    [22, "PRJ-20260709095234", "TASK_CREATED", "Creata attività: Aggiornare la pagina Cucine d'Autore indicando che il servizio è disponibile solo in Toscana."],
    [23, "PRJ-20260709095234", "MEMORY_UPDATE", "Avviato aggiornamento pagina Cucine d'Autore."],
    [24, "PRJ-20260709095234", "PROJECT_UPDATED", "Test invio Desk API"],
    [25, "PRJ-20260709095234", "TASK_CREATED", "Creata attività: Controllare il risultato del test desk-send"],
    [26, "PRJ-20260709095234", "MEMORY_UPDATE", "Test inviato dal client CLI desk-send."],
    [27, "PRJ-20260709135856", "PROJECT_CREATED", "Progetto creato"],
    [28, "PRJ-20260709135856", "PROJECT_UPDATED", "Test Worker"],
    [29, "PRJ-20260709135856", "MEMORY_UPDATE", "Test Worker"],
    [30, "PRJ-20260710094827", "PROJECT_CREATED", "Progetto creato"],
    [31, "PRJ-20260710094827", "PROJECT_UPDATED", "Test update initiated via user request."],
    [32, "PRJ-20260710094827", "MEMORY_UPDATE", "Manual API test update sent."]
  ];

  timelineDeletes.forEach((event, index) => {
    add(
      "V14-DELETE-TIMELINE-" + (index + 1),
      "DELETE",
      "Timeline",
      {
        _rowNumber: event[0],
        "Project ID": event[1],
        Tipo: event[2],
        Descrizione: event[3]
      },
      null,
      "Rimozione evento di test, tecnico o duplicato approvata dall'audit."
    );
  });

  add(
    "V14-CREATE-SCANNER-PROJECT",
    "CREATE",
    "Projects",
    { ID: "PRJ-20260714-SCANNER-001" },
    {
      ID: "PRJ-20260714-SCANNER-001",
      Progetto: "Configurazione scanner di rete",
      Stato: "WAITING",
      Focus: "Analizzare il blocco dello scanner di rete sul PC di Serena e verificare l'interazione con il firewall ESET Protect.",
      Responsabile: "Max",
      "Prossima azione": "Effettuare verifiche dirette sul PC di Serena per completare la diagnosi."
    },
    "Creazione del progetto scanner separato da Desk Assistant."
  );

  add(
    "V14-MOVE-SCANNER-TASK",
    "MOVE",
    "Tasks",
    { ID: "TSK-20260713121015", ProjectID: "PRJ-20260710095800" },
    { ProjectID: "PRJ-20260714-SCANNER-001" },
    "Spostamento della task scanner al progetto corretto."
  );

  [
    ["PROJECT_UPDATED", "Avviato un tentativo per far funzionare lo scanner di rete nonostante il firewall di ESET Protect. La configurazione lato ESET risulta corretta; si attende una verifica diretta sul PC di Serena per completare l'analisi."],
    ["TASK_CREATED", "Creata attività: Eseguire verifiche dirette sul PC di Serena per individuare la causa del blocco dello scanner di rete."],
    ["MEMORY_UPDATE", "Avviata l'analisi dello scanner di rete con firewall ESET Protect; in attesa di verifiche sul PC di Serena."]
  ].forEach((event, index) => {
    add(
      "V14-MOVE-SCANNER-TIMELINE-" + (index + 1),
      "MOVE",
      "Timeline",
      {
        "Project ID": "PRJ-20260710095800",
        Tipo: event[0],
        Descrizione: event[1]
      },
      { "Project ID": "PRJ-20260714-SCANNER-001" },
      "Spostamento dell'evento scanner al progetto corretto."
    );
  });

  [
    "TSK-20260710095805",
    "TSK-20260710102209"
  ].forEach((taskId, index) => {
    add(
      "V14-COMPLETE-RELEASE-TASK-" + (index + 1),
      "COMPLETE",
      "Tasks",
      { ID: taskId, Status: "Aperta" },
      { Status: "Completata" },
      "Completamento di una verifica conclusa entro la release v1.3."
    );
  });

  add(
    "V14-RESTORE-WEBSITE-PROJECT",
    "UPDATE",
    "Projects",
    { ID: "PRJ-20260709095234" },
    {
      Stato: "IN_PROGRESS",
      Focus: "Specificare nella pagina Cucine d'Autore che il servizio è disponibile esclusivamente in Toscana.",
      "Prossima azione": "Aggiornare la pagina Cucine d'Autore con l'indicazione relativa alla disponibilità in Toscana."
    },
    "Rimozione dello stato tecnico introdotto dal test desk-send."
  );

  add(
    "V14-RESTORE-DESK-ASSISTANT",
    "UPDATE",
    "Projects",
    { ID: "PRJ-20260710095800" },
    {
      Stato: "IN_PROGRESS",
      Focus: "Preparare la release v1.4 con bonifica del database e introduzione dei workspace.",
      "Prossima azione": "Approvare ed eseguire la bonifica dei dati prima della migrazione multi-workspace."
    },
    "Separazione dello stato scanner dal progetto Desk Assistant."
  );

  add(
    "V14-NORMALIZE-TRANSFER-STATUS",
    "UPDATE",
    "Projects",
    { ID: "PRJ-20260708130248", Stato: "Attivo" },
    { Stato: "IN_PROGRESS" },
    "Normalizzazione dello stato legacy del progetto reale."
  );

  const actionPriority = {
    CREATE: 10,
    MOVE: 20,
    COMPLETE: 30,
    UPDATE: 30,
    DELETE: 40
  };

  operations.sort((left, right) => {
    const leftPriority = left.action === "DELETE" && left.sheet === "Projects"
      ? 50
      : actionPriority[left.action];
    const rightPriority = right.action === "DELETE" && right.sheet === "Projects"
      ? 50
      : actionPriority[right.action];

    return leftPriority - rightPriority;
  });

  operations.forEach((operation, index) => {
    operation.executionOrder = index + 1;
  });

  return {
    migrationId: "V14_DATA_FOUNDATION",
    version: "1.4.0-milestone.1",
    description: "Baseline e piano approvato per la bonifica Desk v1.4.",
    mode: "DRY_RUN_ONLY",
    baseline: {
      source: "audit/Desk-export-2026-07-14.xlsx",
      sheets: {
        Projects: {
          recordCount: 11,
          requiredHeaders: [
            "ID", "Progetto", "Stato", "Focus", "Responsabile",
            "Prossima azione", "Creato il", "Ultimo aggiornamento"
          ],
          idField: "ID",
          ids: [
            "PRJ-20260708-090927", "PRJ-20260708091734",
            "PRJ-20260708092355", "PRJ-20260708093126",
            "PRJ-20260708094055", "PRJ-20260708130248",
            "PRJ-20260709095234", "PRJ-20260709135856",
            "PRJ-20260710094827", "PRJ-20260710095800",
            "PRJ-20260710130212"
          ]
        },
        Tasks: {
          recordCount: 13,
          requiredHeaders: [
            "ID", "ProjectID", "Title", "Description", "Status",
            "Priority", "Assignee", "DueDate", "CreatedAt",
            "UpdatedAt", "CompletedAt"
          ],
          idField: "ID",
          ids: [
            "TSK-20260708123408", "TSK-20260708124016",
            "TSK-20260708124958", "TSK-20260708133702",
            "TSK-20260708134817", "TSK-20260708135550",
            "TSK-20260709095236", "TSK-20260709104710",
            "TSK-20260709113435", "TSK-20260710095805",
            "TSK-20260710102209", "TSK-20260710130215",
            "TSK-20260713121015"
          ],
          assertions: [{
            selector: {
              ProjectID: "PRJ-20260709095234",
              Title: "Aggiornare la pagina Cucine d'Autore indicando che il servizio è disponibile solo in Toscana."
            },
            expectedMatches: 2
          }]
        },
        Timeline: {
          recordCount: 45,
          requiredHeaders: ["Data", "Project ID", "Tipo", "Descrizione"],
          assertions: [{
            selector: {
              "Project ID": "PRJ-20260710095800",
              Tipo: "MEMORY_UPDATE",
              Descrizione: "Avviata l'analisi dello scanner di rete con firewall ESET Protect; in attesa di verifiche sul PC di Serena."
            },
            expectedMatches: 1
          }]
        },
        Settings: {
          recordCount: 0,
          requiredHeaders: []
        }
      }
    },
    operations: operations
  };

}

const V14_DATA_FOUNDATION_MANIFEST = createV14DataFoundationManifest();
