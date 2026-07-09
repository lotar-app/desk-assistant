# Desk

Desk e' un centro operativo personale costruito con Google Apps Script e Google Sheets.

Non e' un project manager generico, un CRM o una replica di Notion/Trello. Il suo scopo e' permettere di riaprire un progetto dopo giorni o settimane e capire rapidamente:

- dove si era rimasti;
- qual e' il focus attuale;
- qual e' la prossima azione;
- quali task sono aperte o completate;
- quali eventi recenti sono stati registrati nella Timeline.

## Obiettivo

Desk deve ridurre il tempo necessario per riprendere un lavoro. La Sidebar e' l'interfaccia principale: da li' si leggono e aggiornano progetti, task e stato operativo.

## Filosofia

- Velocita' prima della quantita' di funzionalita'.
- Una sola interfaccia principale.
- Ogni modifica rilevante deve lasciare traccia nella Timeline.
- I dati devono esistere una sola volta nei fogli Google Sheets.
- Nessuna dipendenza esterna oltre a Google Apps Script e clasp.

## Architettura

Il progetto segue il flusso:

```text
UI
↓
Service
↓
Repository
↓
Google Sheets
```

La UI non deve accedere direttamente ai fogli. Le funzioni chiamate da `google.script.run` vivono in `UI.js`, delegano ai Service, e i Service delegano ai Repository.

## Struttura del progetto

```text
.
├── appsscript.json
├── .clasp.json
├── Constants.js
├── Settings.js
├── Menu.js
├── Setup.js
├── UI.js
├── DeskPanel.html
├── Projects.js
├── ProjectService.js
├── ProjectRepository.js
├── Tasks.js
├── TaskService.js
├── TaskRepository.js
├── TimelineService.js
├── Timeline.js
└── Utils.js
```

### Responsabilita' dei file

`appsscript.json`  
Configura runtime Apps Script V8, timezone `Europe/Rome` e logging Stackdriver.

`.clasp.json`  
Collega la cartella locale allo script Apps Script remoto tramite `scriptId`.

`Settings.js`  
Contiene `CONFIG`: nomi fogli, mapping colonne, stati progetto, stati task, priorita' task e owner di default.

`Constants.js`  
Contiene gli header dei fogli `Projects`, `Tasks` e `Timeline`.

`Menu.js`  
Crea il menu `Desk` all'apertura dello Spreadsheet. Attualmente espone voci per nuovo progetto, apertura Sidebar, nuova attivita' e aggiornamento dashboard.

`Setup.js`  
Crea i fogli `Projects`, `Tasks`, `Timeline`, `Settings` se mancanti e rimuove `Foglio1`.

`UI.js`  
Espone le funzioni server chiamate dalla Sidebar:

- `showUpdateProject()`
- `getProjects()`
- `getProject(id)`
- `saveProjectUpdate(payload)`
- `getProjectTasks(projectId)`
- `completeTask(id)`

Include anche funzioni di serializzazione per rendere date e task compatibili con `google.script.run`.

`DeskPanel.html`  
Sidebar principale. Permette di:

- selezionare un progetto;
- visualizzare e modificare Focus e Prossima azione;
- scrivere un aggiornamento;
- vedere le task del progetto;
- creare una nuova task;
- completare task tramite checkbox;
- salvare modifiche con feedback inline.

`Projects.js`  
Contiene `newProject()`, handler menu per creare un progetto tramite prompt.

`ProjectService.js`  
Contiene la logica applicativa dei progetti:

- creazione progetto;
- recupero progetto;
- aggiornamento Focus/Prossima azione;
- registrazione Timeline per creazione e aggiornamento.

`ProjectRepository.js`  
Accede al foglio `Projects`:

- append;
- list;
- getById;
- update.

`Tasks.js`  
Contiene `newTask()`, handler menu per creare una task tramite prompt numerato.

`TaskService.js`  
Contiene la logica applicativa delle task:

- creazione;
- aggiornamento;
- elenco per progetto;
- completamento;
- registrazione Timeline per creazione e completamento.

`TaskRepository.js`  
Accede al foglio `Tasks`:

- append;
- update;
- list;
- listByProject;
- getById.

`TimelineService.js`  
Contiene `addTimeline(projectId, type, text)`, funzione append-only per registrare eventi nel foglio `Timeline`.

`Timeline.js`  
Attualmente contiene solo `myFunction()` vuota.

`Utils.js`  
Contiene `refreshDesk()`, attualmente placeholder con alert.

## Prerequisiti

- Account Google con accesso a Google Sheets e Google Apps Script.
- Node.js installato localmente.
- clasp installato globalmente:

```bash
npm install -g @google/clasp
```

## Installazione

Clonare o aprire la cartella del progetto:

```bash
cd /Users/maxcontrucci/Desktop/Desk
```

Installare clasp se non presente:

```bash
npm install -g @google/clasp
```

## Login clasp

```bash
clasp login
```

Il login apre il browser e collega l'ambiente locale all'account Google.

## Push e Pull

Inviare modifiche locali ad Apps Script:

```bash
clasp push
```

Scaricare modifiche remote:

```bash
clasp pull
```

Aprire il progetto Apps Script:

```bash
clasp open
```

## Setup iniziale

Nel progetto Apps Script eseguire manualmente:

```javascript
setupDesk()
```

La funzione crea i fogli richiesti:

- `Projects`
- `Tasks`
- `Timeline`
- `Settings`

Gli header vengono aggiunti dai flussi applicativi quando i fogli sono vuoti:

- `Projects.js` per `Projects`;
- `TaskRepository.append()` o `Tasks.js` per `Tasks`;
- `TimelineService.js` per `Timeline`.

## Come aggiungere nuove funzionalita'

Seguire sempre il flusso:

```text
UI.js / DeskPanel.html
↓
Service
↓
Repository
↓
Google Sheets
```

Per un nuovo dominio:

1. Aggiungere configurazione colonne in `Settings.js`.
2. Aggiungere eventuali header in `Constants.js`.
3. Creare un Repository dedicato.
4. Creare un Service dedicato.
5. Esporre solo le funzioni necessarie in `UI.js`.
6. Aggiornare `DeskPanel.html` se la funzionalita' appartiene alla Sidebar.
7. Registrare in Timeline ogni modifica di stato rilevante.

## Convenzioni del progetto

- Naming domini al singolare per Service/Repository: `ProjectService`, `TaskRepository`.
- Handler globali Apps Script in file dedicati: `Projects.js`, `Tasks.js`, `UI.js`.
- Accesso ai fogli solo nei Repository o in servizi infrastrutturali esistenti come `TimelineService.js`.
- Date native nei Repository/Service; stringhe serializzate verso la UI.
- Messaggi UI non invasivi nella Sidebar; evitare `alert()` nei nuovi flussi Sidebar.
- Non introdurre dipendenze esterne senza decisione esplicita.
- Non modificare il modello dati senza richiesta.
