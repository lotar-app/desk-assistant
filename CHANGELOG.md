# Changelog

Tutte le modifiche rilevanti a Desk sono documentate in questo file.

Il formato segue [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), con adattamento al ciclo di sviluppo interno del progetto.

## [Unreleased]

### Da fare

- Ricerca nella Sidebar.
- Dashboard V1.
- Vista Timeline consultabile.
- Archiviazione progetti.
- Filtri task.

## [0.1.0] - 2026-07-08

### Added

- Configurazione Apps Script con runtime V8, timezone `Europe/Rome` e logging Stackdriver.
- Integrazione clasp tramite `.clasp.json`.
- Struttura iniziale del progetto in file `.js` e `.html`.
- Configurazione centrale `CONFIG` in `Settings.js`.
- Header fogli in `Constants.js`.
- Setup iniziale con creazione fogli `Projects`, `Tasks`, `Timeline`, `Settings`.
- Menu Google Sheets `Desk`.
- Architettura iniziale Service/Repository per Projects.
- `ProjectRepository` con append, list, getById e update.
- `ProjectService` con create, get e update.
- Creazione progetto da menu.
- Sidebar `DeskPanel.html`.
- Apertura Sidebar da `UI.js`.
- Lettura progetti da Sidebar.
- Lettura dettaglio progetto da Sidebar.
- Salvataggio Focus e Prossima azione.
- Aggiornamento `updatedAt` del progetto.
- Registrazione Timeline per `PROJECT_CREATED`.
- Registrazione Timeline per `PROJECT_UPDATED`.
- `TimelineService.addTimeline(projectId, type, text)`.
- Modulo Tasks con `TaskRepository`.
- `TaskRepository` con append, update, list, listByProject e getById.
- `TaskService` con create, update, listByProject e complete.
- Creazione task da menu.
- Creazione task dalla Sidebar.
- Collegamento task-progetto tramite `ProjectID`.
- Visualizzazione task nella Sidebar.
- Completamento task da checkbox nella Sidebar.
- Registrazione Timeline per `TASK_CREATED`.
- Registrazione Timeline per `TASK_COMPLETED`.
- Serializzazione date per risposte `google.script.run`.
- Messaggio inline `Salvato ✓` nella Sidebar.
- Indicatore `Caricamento...` nella Sidebar.
- Lista task con aperte prima e completate dopo.
- Task completate visualizzate con checkbox selezionata, testo barrato e colore grigio.

### Changed

- La Sidebar e' diventata il centro operativo principale.
- Il salvataggio progetto puo' creare una task opzionale nello stesso flusso.
- Il completamento task ricarica solo l'elenco task, non l'intero progetto.
- Gli `alert()` sono stati rimossi dai flussi Sidebar.

### Known Issues

- `refreshDesk()` e' ancora un placeholder.
- `Timeline.js` contiene solo una funzione vuota.
- La Dashboard non e' implementata.
- La Timeline non ha ancora una vista consultabile.
- Alcuni flussi menu usano ancora prompt e alert.
- `setupDesk()` crea i fogli ma non centralizza tutti gli header.
