# Desk

Sistema Desk + Desk Assistant

Desk è il sistema di memoria operativa basato su Google Sheets e Google Apps Script. Consente di riprendere rapidamente il lavoro su un progetto consultandone stato, focus, prossima azione, attività ed eventi recenti.

Desk Assistant è il Custom GPT che permette di leggere e aggiornare Desk tramite linguaggio naturale. Questo repository contiene il motore Desk e le componenti necessarie alla sua integrazione con il Custom GPT.

Il progetto non è un project manager generalista: privilegia un flusso quotidiano essenziale e mira a rendere nuovamente comprensibile un progetto in meno di 30 secondi.

## Obiettivo del progetto

Desk mantiene in un unico sistema:

- progetti e relativo stato operativo;
- attività collegate ai progetti;
- una Timeline append-only delle modifiche rilevanti;
- briefing composti per Sidebar e assistente;
- aggiornamenti provenienti dalla conversazione;
- lettura e aggiornamento dei progetti tramite API e Custom GPT.

Google Sheets è la persistenza, Google Apps Script esegue la logica applicativa e la Sidebar è l'interfaccia operativa principale.

## Architettura

Il flusso applicativo di base è:

```text
Sidebar / menu / API
        ↓
UI / ConversationEngine
        ↓
DeskEngine
        ↓
Service
        ↓
Repository
        ↓
Google Sheets
```

La Sidebar invoca funzioni Apps Script tramite `google.script.run`. `UI.js` espone dati serializzabili e delega le operazioni di livello alto a `DeskEngine`; i Service applicano validazioni e regole di dominio; i Repository sono il livello che accede ai fogli.

Il flusso dell'integrazione GPT è:

```text
Custom GPT
    ↓
Action OpenAPI
    ↓
Cloudflare Worker
    ↓
Web App Google Apps Script
    ↓
ConversationEngine / DeskEngine
    ↓
Service → Repository → Google Sheets
```

Il Cloudflare Worker, esterno a questo repository, aggiunge il token prima di inoltrare la richiesta. La Web App espone `doGet()` per il controllo di disponibilità e `doPost()` per la lettura o l'aggiornamento dei progetti.

## Workspace Briefing

Il Workspace Briefing offre una vista operativa unica dello stato corrente di Desk. Aggrega Projects, Tasks aperte e Timeline per mostrare contesto recente, segnali di attenzione, priorità registrate, prossime azioni disponibili, contesti in attesa e possibili punti di partenza. Il briefing è esclusivamente read-only: non crea e non aggiorna dati.

L'architettura segue la pipeline completa dell'assistente:

```text
Comando conversazionale "Desk"
        ↓
Custom GPT → Action OpenAPI getWorkspaceBriefing
        ↓
Cloudflare Worker (routing e autenticazione)
        ↓
Apps Script → ConversationEngine → DeskEngine
        ↓
ProjectService + TaskService + TimelineService
        ↓
Google Sheets
```

Quando l'utente scrive `Desk`, il GPT richiama automaticamente `getWorkspaceBriefing` senza parametri opzionali e Apps Script seleziona il workspace predefinito. `Desk freelance` usa lo scope `FREELANCE`, `Desk tutte` usa `ALL` e `Desk <workspace>` risolve nome o alias prima di usare il relativo Workspace ID. L'Action invia la richiesta al percorso del Worker; il Worker aggiunge le credenziali, inoltra la richiesta ad Apps Script e restituisce al GPT esclusivamente il payload reale dell'API. Apps Script legge e aggrega i dati senza eseguire operazioni di scrittura. L'autenticazione è gestita esclusivamente dal Worker e non viene esposta al GPT o allo schema OpenAPI.

Le tre Action hanno responsabilità distinte:

- `updateDesk` applica un aggiornamento conversazionale a un progetto e può modificare progetto, attività e Timeline;
- `getProject` legge un singolo progetto identificato per nome;
- `getWorkspaceBriefing` legge e aggrega l'intero contesto operativo del workspace, senza modificare alcun dato.

## Componenti

### Interfaccia e setup

- `DeskPanel.html`: Sidebar per selezionare e aggiornare un progetto, vedere o creare attività e completarle.
- `UI.js`: endpoint server della Sidebar e serializzazione di progetti, attività, Timeline e date.
- `Menu.js`: menu Google Sheets per creare progetti e attività, aprire la Sidebar e richiamare il placeholder della Dashboard.
- `Projects.js` e `Tasks.js`: handler legacy o di fallback basati sui prompt del menu.
- `Setup.js`: creazione iniziale dei fogli applicativi, inclusi `Workspaces` e `WorkspaceAliases`.
- `Settings.js` e `Constants.js`: configurazione di fogli, colonne, stati, valori predefiniti e header.

### Dominio e persistenza

- `ProjectService.js` / `ProjectRepository.js`: creazione, ricerca, lettura e aggiornamento dei progetti.
- `WorkspaceService.js`, `WorkspaceRepository.js` e `WorkspaceAliasRepository.js`: identità, nomi, alias e appartenenza ai workspace.
- `WorkspaceDataQualityService.js`: diagnostica amministrativa di workspace, riferimenti e record orfani.
- `WorkspaceMigration.js`: preflight read-only e generazione delle sole operazioni derivate da mapping esplicito.
- `TaskService.js` / `TaskRepository.js`: creazione, lettura, aggiornamento e completamento delle attività.
- `TimelineService.js` / `TimelineRepository.js`: registrazione append-only e lettura degli eventi recenti.
- `DeskEngine.js`: orchestrazione di briefing, aggiornamenti progetto, attività, Timeline e aggiornamenti preparati.
- `MemoryUpdate.js`: contratto e validazione degli aggiornamenti strutturati provenienti dall'assistente.
- `ConversationEngine.js`: ricerca del progetto per nome e applicazione degli aggiornamenti conversazionali; crea il progetto se un aggiornamento riguarda un nome non ancora presente.
- `WorkspaceAdmin.js`: entry point amministrativi per gestione, assegnazione, rinomina, disattivazione e merge dei workspace.

### API e integrazione GPT

- `Api.js`: Web App Apps Script con `doGet()`, `doPost()` e risposte JSON.
- `ApiConfig.js`: configurazione della Web App e dell'API.
- `openapi/desk-action.openapi.yaml`: schema delle Action di lettura e aggiornamento.
- `gpt/DESK_ASSISTANT_INSTRUCTIONS.md`: istruzioni operative del Custom GPT.
- `desk-send.js`: client CLI Node.js per inviare aggiornamenti alla Web App.
- `scripts/link-local-bin.js`: collegamento locale del comando `desk` eseguito da `postinstall`.

### Documentazione e supporto

- `ENGINE_DESIGN.md`, `CONVERSATION_ENGINE.md`, `MEMORY_UPDATE.md` e `PREPARED_UPDATE.md`: design e contratti dei flussi Engine e memoria.
- `MemoryFlowDemo.js` e `TestConversationEngine.js`: demo e test manuali Apps Script dei flussi conversazionali.
- `ROADMAP.md`: stato funzionale e sviluppi pianificati; le voci non completate non fanno parte delle funzionalità correnti.
- `CHANGELOG.md`: cronologia delle versioni.
- `CONTRIBUTING.md`: regole e workflow di contribuzione.
- `Timeline.js` e `Utils.js`: file legacy; `Timeline.js` contiene una funzione vuota e `Utils.js` il placeholder di aggiornamento Dashboard.

## Struttura del repository

```text
.
├── appsscript.json
├── Api.js
├── ApiConfig.js
├── Constants.js
├── ConversationEngine.js
├── DeskEngine.js
├── DeskPanel.html
├── Menu.js
├── MemoryUpdate.js
├── ProjectRepository.js
├── ProjectService.js
├── Projects.js
├── Settings.js
├── Setup.js
├── TaskRepository.js
├── TaskService.js
├── Tasks.js
├── Timeline.js
├── TimelineRepository.js
├── TimelineService.js
├── UI.js
├── Utils.js
├── desk-send.js
├── openapi/
│   └── desk-action.openapi.yaml
├── gpt/
│   └── DESK_ASSISTANT_INSTRUCTIONS.md
├── scripts/
│   └── link-local-bin.js
├── package.json
├── package-lock.json
└── documentazione tecnica (*.md)
```

La configurazione locale clasp è conservata in `.clasp.json`. Il manifest Apps Script usa runtime V8, timezone `Europe/Rome` e logging Stackdriver.

## Principi del progetto

- Applicare modifiche minime e circoscritte rispetto all'obiettivo richiesto.
- Evitare regressioni nei flussi esistenti di Sidebar, API, progetti, attività e Timeline.
- Mantenere stabile l'architettura e rispettarne i confini.
- Sottoporre ogni modifica a review tecnica obbligatoria prima del deploy.
- Aggiornare `CHANGELOG.md` a ogni release.
- Evitare duplicazioni dei dati tra i fogli e tra i componenti.
- Mantenere separati UI, Engine, Service, Repository e persistenza.

## Workflow di sviluppo

1. Analizzare il codice e la documentazione esistenti, distinguendo funzionalità implementate e roadmap.
2. Applicare modifiche piccole nel livello corretto: UI, Engine, Service o Repository.
3. Se cambia un dominio, aggiornare nell'ordine configurazione e header, Repository, Service, API di livello alto e infine UI.
4. Registrare nella Timeline ogni modifica di stato rilevante.
5. Verificare sintassi, validazioni, serializzazione delle date e assenza di accessi diretti ai fogli dai livelli superiori.
6. Eseguire `clasp push`.
7. Aprire Google Sheets e provare manualmente i flussi coinvolti nella Sidebar, controllando anche Timeline ed errori Apps Script.
8. Per l'integrazione esterna, verificare separatamente lettura e scrittura lungo l'intera pipeline GPT → Worker → Apps Script → Sheets.
9. Aggiornare documentazione e changelog quando la modifica è rilevante.

Per il client CLI:

```bash
npm install
npm run desk-send -- --help
```

## Versioni

### v1.0

- architettura iniziale completata;
- pipeline Custom GPT → OpenAPI → Cloudflare Worker → Apps Script → Google Sheets funzionante;
- primo supporto all'aggiornamento automatico di Desk.

### v1.1

- token rimosso dalle istruzioni del Custom GPT e dallo schema OpenAPI;
- autenticazione spostata nel Cloudflare Worker, che aggiunge `DESK_API_TOKEN` alla richiesta;
- aggiornamento dei progetti validato tramite Worker.

### v1.2 — 10 luglio 2026

- aggiunta l'Action OpenAPI `getProject`;
- aggiunta la consultazione dello stato dei progetti dal Custom GPT;
- autenticazione demandata esclusivamente al Cloudflare Worker;
- corretto il passaggio di `projectName` e validato il flusso end-to-end di lettura e scrittura.

### v1.3

- introdotti `getWorkspaceBriefing` e il comando conversazionale `Desk`;
- aggiunta la lettura aggregata e read-only di Projects, Tasks e Timeline;
- completati il routing del Worker e la pipeline GPT → OpenAPI → Worker → Apps Script → Google Sheets;
- validato con esito positivo il flusso end-to-end del briefing.

La versione `0.1.0` in `package.json` identifica attualmente il pacchetto Node locale e non sostituisce la cronologia applicativa v1.0–v1.3.

## Regole architetturali

- Google Sheets contiene i dati, non la logica applicativa.
- UI, Sidebar, Chat e API non leggono o scrivono direttamente i fogli.
- I Repository sono l'unico livello del dominio autorizzato ad accedere ai fogli.
- I Service contengono validazioni, regole di dominio, date, ID e registrazione degli eventi.
- `DeskEngine` coordina i flussi e compone i dati senza sostituire Service o Repository.
- Le date native devono essere convertite in stringhe prima di essere restituite alla Sidebar.
- La Timeline è append-only e ogni modifica di stato rilevante deve lasciare traccia.
- I dati non devono essere duplicati tra fogli.
- Il modello dati, i nomi delle colonne e gli header non vanno cambiati senza una migrazione concordata.
- La Sidebar resta l'interfaccia principale; menu e prompt sono accessi legacy o di fallback.
- Nei flussi principali della Sidebar si usano messaggi inline, stato di caricamento e pulsanti disabilitati durante le operazioni asincrone.
- Gli aggiornamenti preparati devono essere validati prima dell'applicazione.
- Non introdurre dipendenze o funzionalità estranee all'obiettivo operativo senza una decisione esplicita.

## Procedura di rilascio

Per la Workspace Foundation, la sequenza amministrativa è:

1. completare Task ID Repair, se necessaria;
2. eseguire `LEGACY_WORKSPACE_NORMALIZATION_V1`;
3. rieseguire il preflight Workspace Foundation;
4. eseguire `WORKSPACE_FOUNDATION_V1` soltanto dopo un preflight positivo.

1. Verificare che le modifiche rispettino la separazione UI → Engine/Service → Repository → Google Sheets.
2. Controllare che configurazione, schema dati e Timeline siano coerenti e che nessun segreto reale sia incluso nel repository.
3. Eseguire i controlli sintattici e i test manuali pertinenti, inclusi `TestConversationEngine.js` o il client CLI quando il rilascio coinvolge l'API.
4. Pubblicare i file Apps Script:

   ```bash
   clasp push
   ```

5. Aprire il progetto remoto con `clasp open`, quindi provare i flussi modificati sul foglio Google.
6. Se cambia la Web App, creare o aggiornare il deployment Apps Script dalla relativa interfaccia e mantenere l'URL usato dal Cloudflare Worker coerente con il deployment.
7. Se cambiano le Action, aggiornare `openapi/desk-action.openapi.yaml` nel Custom GPT e verificare `getProject` e l'aggiornamento progetto tramite Worker.
8. Eseguire un test end-to-end e controllare che la risposta raggiunga nuovamente il GPT.
9. Aggiornare `CHANGELOG.md` con versione, modifiche e validazioni effettuate.

La configurazione e il deployment del Cloudflare Worker non sono contenuti in questo repository; il loro rilascio deve quindi essere gestito nel relativo ambiente esterno.
