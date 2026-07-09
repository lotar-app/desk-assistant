# Contributing

Questa guida definisce come sviluppare Desk mantenendo architettura, stile e obiettivo del progetto.

Desk deve restare un centro operativo personale veloce. Ogni modifica deve aiutare a riprendere un progetto in meno tempo.

## Architettura

Il flusso obbligatorio e':

```text
UI
↓
Service
↓
Repository
↓
Google Sheets
```

### UI

La UI e' composta da:

- `DeskPanel.html` per la Sidebar;
- `UI.js` per le funzioni server chiamate da `google.script.run`;
- handler menu come `newProject()` e `newTask()` per funzioni legacy o fallback.

La UI non deve leggere o scrivere direttamente i fogli.

### Service

I Service contengono la logica applicativa:

- validazioni;
- regole di dominio;
- generazione ID;
- aggiornamento date;
- chiamate ai Repository;
- registrazione Timeline.

Esempi:

- `ProjectService`
- `TaskService`

### Repository

I Repository sono l'unico livello che accede ai fogli Google Sheets per il dominio applicativo.

Esempi:

- `ProjectRepository`
- `TaskRepository`

## Convenzioni di naming

- Service: `NomeDominioService`
- Repository: `NomeDominioRepository`
- File service: `NomeDominioService.js`
- File repository: `NomeDominioRepository.js`
- Costanti header: `NOME_HEADERS`
- Mapping colonne: `CONFIG.NOME_COLUMNS`
- Stati dominio: `CONFIG.NOME_STATUS`
- Handler Apps Script globali: nomi descrittivi e brevi, ad esempio `showUpdateProject`, `newTask`, `completeTask`.

Mantenere i nomi esistenti. Non rinominare file, funzioni o colonne senza una richiesta esplicita.

## Come creare un nuovo modulo

1. Definire il foglio o i dati coinvolti.
2. Aggiungere mapping colonne in `Settings.js`.
3. Aggiungere header in `Constants.js` se serve un nuovo foglio.
4. Creare un Repository.
5. Creare un Service.
6. Esporre funzioni in `UI.js` solo se servono alla Sidebar.
7. Aggiornare `DeskPanel.html` solo per il comportamento UI.
8. Registrare in Timeline ogni modifica di stato.

## Come creare un Repository

Un Repository deve:

- esporre `sheet()` per recuperare il foglio;
- usare `CONFIG.SHEETS`;
- usare `CONFIG.*_COLUMNS`;
- convertire righe in oggetti con una funzione dedicata se il dominio ha molte colonne;
- restituire `null` quando un record non viene trovato;
- evitare logica di dominio.

Esempio di responsabilita':

```text
TaskRepository.getById(id)
↓
legge il foglio Tasks
↓
trova la riga
↓
restituisce un oggetto task o null
```

## Come creare un Service

Un Service deve:

- validare input e payload;
- verificare che i record collegati esistano;
- generare ID se necessario;
- impostare `CreatedAt`, `UpdatedAt`, `CompletedAt` quando previsto;
- chiamare Repository;
- chiamare `addTimeline()` per eventi rilevanti;
- restituire dati coerenti al chiamante.

Un Service non deve contenere codice HTML o manipolazione DOM.

## Come modificare la UI

La Sidebar vive in `DeskPanel.html`.

Regole:

- niente `alert()` nei flussi principali;
- usare messaggi inline;
- mostrare `Caricamento...` durante chiamate server;
- disabilitare `Salva` durante operazioni asincrone;
- chiamare il server tramite `google.script.run`;
- non accedere direttamente ai fogli;
- non duplicare logica di dominio gia' presente nei Service.

`UI.js` deve restituire solo dati serializzabili verso `google.script.run`. Le date vanno convertite in stringhe.

## Regole obbligatorie

- Rispettare Service/Repository.
- Non modificare il modello dati senza richiesta.
- Non introdurre dipendenze esterne.
- Non duplicare dati tra fogli.
- Ogni modifica di stato deve aggiornare la Timeline.
- Ogni nuova funzione deve essere coerente con l'obiettivo dei 30 secondi.
- Mantenere lo stile del codice esistente.
- Testare sintassi e flussi principali prima di considerare chiusa una modifica.

## Cosa NON fare

- Non leggere o scrivere fogli da `DeskPanel.html`.
- Non mettere logica di dominio in `UI.js`.
- Non creare nuove sidebar parallele senza decisione esplicita.
- Non aggiungere menu se la funzione puo' vivere nella Sidebar.
- Non usare prompt nei nuovi flussi principali.
- Non introdurre librerie esterne.
- Non cambiare nomi colonne o header senza migrazione concordata.
- Non aggiungere funzionalita' che rallentano l'uso quotidiano.

## Workflow di sviluppo

1. Sviluppo
   - Analizzare il codice esistente.
   - Applicare modifiche piccole e coerenti.
   - Aggiornare Service, Repository e UI nei rispettivi livelli.

2. Code review
   - Verificare architettura.
   - Cercare duplicazioni.
   - Controllare che la Timeline venga aggiornata quando serve.
   - Controllare che non siano state introdotte dipendenze o modifiche dati non richieste.

3. clasp push
   - Pubblicare su Apps Script:

```bash
clasp push
```

4. Test
   - Aprire Google Sheets.
   - Aprire la Sidebar.
   - Testare progetto, task e Timeline coinvolti.
   - Verificare eventuali errori in Apps Script.

5. Milestone completata
   - Aggiornare documentazione o changelog se la modifica e' rilevante.
   - Segnalare criticita' residue.

## Formato risposta Codex dopo ogni modifica

Ogni risposta finale deve includere:

- file modificati;
- riepilogo;
- criticita';
- suggerimenti.

Se non sono stati modificati file, indicarlo esplicitamente.
