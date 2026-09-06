# Desk Assistant - Changelog

## ProjectActivity activation - 2026-09-06

### Added
- Attivate le Actions `getProjectActivity` e `updateProjectActivity` con
  autenticazione bearer dedicata e separata dalle route amministrative.
- Attivato Cloudflare D1 `desk-projectactivity` con migrazioni 0001–0003,
  optimistic concurrency, idempotenza, revisioni e outbox.
- Attivato il registro Apps Script `ProjectActivityTimelineDelivery` tramite
  `PROJECT_ACTIVITY_TIMELINE_DELIVERY_V1`.

### Changed
- Pubblicata l'architettura Timeline transizionale: writer Desk legacy A-D,
  writer ProjectActivity canonico A-G e parser mixed-layout.
- Pubblicate le istruzioni production del Desk Assistant e rese disponibili le
  sei Actions `updateDesk`, `getProject`, `getProjectTasks`,
  `getProjectActivity`, `updateProjectActivity`, `getWorkspaceBriefing`.

### Fixed
- Corretto il binding del `fetch` nativo nel delivery Worker, preservando fetch
  iniettato, diagnostica sanitizzata e semantica di retry.
- Resa esplicita `components.schemas` per la compatibilità del parser GPT
  Actions.

### Validation
- Gate 7 E2E completato: snapshot, conflitti, idempotenza, outbox, Timeline e
  registro verificati senza duplicati.
- Gate 8 e Gate 9 completati: Actions, auth, istruzioni e test post-save
  verificati, incluse pipeline ProjectActivity e legacy Desk.
- Fixture finale: `ProjectActivity Smoke Test`, snapshotVersion 6,
  `test.flag` assente dopo revoca esplicita.
- Copie client temporanee dei token eliminate senza esposizione dei valori.
- Il rendering dei marker Markdown delle task è un limite prompt-only
  non bloccante e non costituisce garanzia runtime.

## v1.4 - Unreleased

### Added
- Introdotta l'entità Workspace con ID immutabili, stato, default e nomi modificabili.
- Aggiunti alias multipli, diagnostica amministrativa e mapping di migrazione esplicito per Project ID.
- Aggiunti gli scope briefing `PRIMARY`, `FREELANCE`, `ALL` e `WORKSPACE`.
- Aggiunti test isolati per filtri, alias, assegnazione, rinomina, merge e routing API.
- Introdotto il framework read-only della Milestone 1 Data Foundation.
- Aggiunti Backup Engine, Baseline Validator e Dry Run Engine.
- Aggiunti manifesto versionato della migrazione v1.4 e checksum SHA-256.
- Aggiunti MigrationLog in memoria e Rollback Engine non eseguibile.
- Aggiunti test isolati che verificano baseline, dry run, divergenze e assenza di scritture.
- Aggiunta la documentazione tecnica del framework di migrazione.
- Implementato il motore protetto della Milestone 2A con writer reale e lock applicativo.
- Aggiunto backup fisico verificato tramite copia Google Sheets ed export XLSX.
- Aggiunto `MigrationLog` persistente, append-only e firmato per singola voce.
- Aggiunti rollback eseguibile, precondizioni sullo stato corrente e compensazione in caso di errore del log.
- Aggiunti test end-to-end su Spreadsheet e Drive simulati.
- Materializzato il manifesto finale della Milestone 2B in stato `EXECUTION_READY`.
- Sostituito l'ID scanner manuale con un ID derivato da `ProjectService`.
- Materializzati come Date i timestamp storici di scanner e task v1.3.
- Aggiunti firma separata del manifesto e validazione automatica completa del preflight.

### Safety
- Nessun componente della Milestone 1 modifica Google Sheets.
- Nessuna bonifica o migrazione Workspace viene eseguita.
- Il manifesto reale resta in modalità `DRY_RUN_ONLY`; il rollback eseguibile richiede un piano autorizzato e conferma esplicita.
- Il manifesto operativo v1.4 resta non autorizzato e nessun entry point mutativo viene eseguito automaticamente.
- `EXECUTION_READY` non abilita il writer: resta necessaria un'autorizzazione esplicita successiva.

---

## v1.3

### Added
- Introdotto `getWorkspaceBriefing`, il briefing operativo complessivo del workspace.
- Aggiunta la lettura aggregata e read-only di Projects, Tasks e Timeline.
- Aggiunta una nuova Action OpenAPI dedicata a `getWorkspaceBriefing`.
- Aggiunto il comando conversazionale `Desk`, che richiama automaticamente il briefing all'avvio della conversazione.

### Changed
- Esteso il routing del Cloudflare Worker per inoltrare le richieste di workspace briefing.
- Completata l'integrazione GPT → OpenAPI → Worker → Apps Script → Google Sheets per il nuovo flusso.
- L'autenticazione resta gestita esclusivamente dal Cloudflare Worker; il GPT non riceve né invia credenziali.

### Security
- Il workspace briefing è completamente read-only e non modifica Projects, Tasks, Timeline o altri dati di Desk.
- Rimossa la diagnostica temporanea usata durante il debug di `getWorkspaceBriefing`.

### Validation
- Test end-to-end del workspace briefing completati con esito positivo lungo l'intera pipeline.

---

## v1.2 - 2026-07-10

### Added
- Action OpenAPI getProject.
- Lettura dei progetti da Desk tramite Cloudflare Worker.
- Supporto alla consultazione dello stato dei progetti dal Custom GPT.

### Changed
- L'autenticazione è demandata esclusivamente al Cloudflare Worker.
- Il Custom GPT non gestisce più direttamente il token.
- Lo schema OpenAPI utilizza Action dedicate per lettura e aggiornamento.
- Aggiornate le istruzioni del GPT per utilizzare getProject quando l'utente chiede informazioni su un progetto.

### Fixed
- Corretto il passaggio del parametro projectName verso getProject.
- Validata la lettura dei progetti tramite Apps Script.
- Validato il flusso completo:
  Custom GPT → OpenAPI → Cloudflare Worker → Apps Script → Google Sheets → risposta al GPT.

### Validation
- Test Builder completato con successo.
- Test end-to-end completato con successo.
- Lettura e scrittura dei progetti funzionanti.

---

## v1.1

### Changed
- Rimosso il token dalle istruzioni del Custom GPT.
- Rimosso il token dallo schema OpenAPI.
- Il Cloudflare Worker aggiunge automaticamente DESK_API_TOKEN prima di inoltrare la richiesta ad Apps Script.

### Validation
- Aggiornamento dei progetti funzionante tramite Worker.

---

## v1.0

### Initial Release
- Architettura iniziale completata.
- Pipeline funzionante:
  Custom GPT → OpenAPI → Cloudflare Worker → Apps Script → Google Sheets.
- Primo supporto all'aggiornamento automatico di Desk.
