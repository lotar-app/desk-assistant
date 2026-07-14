# Desk Assistant - Changelog

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
