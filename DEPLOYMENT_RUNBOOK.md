# Procedura sicura di rilascio Desk Assistant

Questa procedura va letta prima di ogni aggiornamento di Apps Script o del
Cloudflare Worker.

## Prima del rilascio

1. Verificare che il commit da pubblicare sia quello corretto e sia presente su
   `origin/main`.
2. Se il working tree contiene modifiche non correlate, preparare il deploy da
   una copia temporanea pulita del commit. Non eseguire `clasp push` direttamente
   da un working tree sporco.
3. Eseguire i test pertinenti. Per cambi di stato, verificare insieme il valore
   salvato in Projects e il relativo evento Timeline.
4. Non salvare token reali nel repository e non distribuire
   `CAMBIA_QUESTO_TOKEN` o un token vuoto. Prima di creare la versione Apps
   Script, verificare che la configurazione di deploy contenga il token previsto
   dal Worker, senza stamparlo nei log.

## Pre-deploy checklist

Questa checklist è obbligatoria prima di ogni rilascio. Worker, Apps Script e
schema OpenAPI devono essere verificati e pubblicati come componenti distinti.

### Cloudflare Worker

- Verificare nel file del Worker che il routing previsto dalla release sia
  presente e inoltri l'`action` corretta ad Apps Script.
- Eseguire il deploy dalla directory `worker`:

  ```bash
  npx wrangler deploy
  ```

- Annotare il nuovo Version ID restituito da Wrangler e conservarlo nelle note
  del rilascio.

### Google Apps Script

- Verificare che `.claspignore` escluda `worker/**`, affinché il codice del
  Cloudflare Worker non venga caricato nel progetto Apps Script.
- Verificare che `ApiConfig.js` non contenga il placeholder
  `CAMBIA_QUESTO_TOKEN` né un token vuoto.
- Verificare, senza stampare i valori nei log, che `DESK_API_TOKEN` in
  `ApiConfig.js` coincida con il secret `DESK_API_TOKEN` del Worker.
- Caricare la copia pulita nel progetto Apps Script:

  ```bash
  clasp push
  ```

- Creare una nuova versione immutabile con una descrizione riconoscibile:

  ```bash
  clasp version "descrizione del rilascio"
  ```

- Dalla console Apps Script, aggiornare il deployment della Web App alla nuova
  versione appena creata.
- Verificare che l'URL pubblico della Web App termini in `/exec` e rimanga
  invariato. Se Google genera un URL diverso, fermarsi e riallineare il Worker
  secondo la procedura prevista prima di continuare.

### OpenAPI

- Verificare che ogni nuova Action della release sia presente nello schema
  OpenAPI usato dal GPT.
- Verificare che endpoint e `operationId` coincidano con il routing pubblico del
  Worker.

### Collaudo

- Eseguire il test end-to-end della nuova Action sul sistema realmente
  deployato.
- Eseguire almeno un test del caso di errore previsto dal contratto, verificando
  che non produca scritture o altri effetti collaterali inattesi.
- Verificare nell'ordine che continuino a funzionare:
  - `getProject`;
  - `getWorkspaceBriefing`;
  - `updateDesk`, soltanto dopo il completamento delle verifiche read-only.

### Post-deploy

- Rimuovere eventuali dati di test creati durante il collaudo, dopo averne
  verificato con certezza origine e riferimenti.
- Annotare nelle note del rilascio la versione Apps Script, il deployment Web
  App e il Version ID del Worker effettivamente pubblicati.

> **Errori ricorrenti da evitare**
>
> 1. `clasp push` **NON** pubblica la Web App.
> 2. Dopo `clasp push` è obbligatorio:
>    - eseguire `clasp version`;
>    - aggiornare il deployment della Web App alla nuova versione.
> 3. Il Cloudflare Worker richiede sempre un deploy separato con
>    `wrangler deploy`.
> 4. Worker e Apps Script hanno cicli di deploy indipendenti.
> 5. Se compare `Unauthorized`, verificare immediatamente la corrispondenza tra
>    `DESK_API_TOKEN` del Worker e quello di `ApiConfig.js`.
> 6. Se una nuova Action cade nel flusso `updateDesk`, verificare prima il deploy
>    del Worker e poi quello della Web App.

## Desk V2 — Cloudflare DEV

Questa procedura è separata dal Worker legacy nella directory `worker/` e dalla
pipeline Apps Script. Si applica esclusivamente al Worker MCP Desk V2 nella
directory `v2/`.

### Baseline candidata STEP 33J — non autorizza il rilascio

La baseline seguente descrive esclusivamente la release candidate locale. Il
suo inserimento nel runbook non autorizza commit, migrazioni D1 DEV, deploy,
modifiche ai secret, collegamento ChatGPT o test mutativi. Ognuna di queste
operazioni richiede la propria approvazione esplicita.

La candidate registra **19 tool MCP**: **17 tool di prodotto** e i due tool
diagnostici `desk_v2_capability_read` e `desk_v2_capability_write`. La catena
schema candidata comprende esattamente le migrazioni `0001`–`0006` elencate
più avanti. Prima del deploy restano bloccanti:

- OAuth 2.1 conforme al contratto MCP/ChatGPT; il bearer statico è soltanto una
  protezione tecnica corrente e non deve essere distribuito a ChatGPT;
- applicazione separatamente autorizzata di `0005` e `0006` al D1 DEV;
- validazione della catena SQL, delle foreign key, dei trigger append-only e
  dell'atomicità su D1/Miniflare, senza dedurla dai soli fake DB o SQLite;
- aggiornamento di `/ready`, che attualmente verifica soltanto la migration
  foundation minima e non certifica la baseline `0001`–`0006`;
- completamento dei test di integrazione Wrangler/Miniflare e dei controlli
  read-only post-deploy.

### Identità autorizzata

Prima di qualsiasi deploy verificare in sola lettura:

- account Cloudflare:
  `9f6a80897801df9b42d59eae9730c6a1`;
- Worker:
  `desk-v2-foundation-dev`;
- URL:
  `https://desk-v2-foundation-dev.fastmax.workers.dev`;
- database D1:
  `desk-v2-foundation-dev`;
- UUID D1:
  `e2b252a0-ec15-48a8-bcd6-aed6d49427a3`;
- binding D1:
  `DESK_V2_DB`;
- entry point:
  `src/index.mjs`.

Fermarsi senza deploy se uno qualsiasi di questi valori non coincide.

### Prerequisiti Git

1. Il commit esatto autorizzato per il deploy deve essere già presente su
   `origin/main`.
2. Verificare che lo SHA locale e quello di `origin/main` coincidano con il
   commit autorizzato.
3. Non distribuire direttamente da un working tree contenente modifiche non
   correlate.
4. Se il working tree originale non è pulito, creare un checkout temporaneo
   isolato del commit esatto senza eseguire reset, stash o checkout nel
   repository originale.

Esempio:

```bash
DEPLOY_SHA="<sha-autorizzato>"
TEMP_DIR="$(mktemp -d)"
git worktree add --detach "$TEMP_DIR" "$DEPLOY_SHA"
```

Verificare nel checkout temporaneo:

```bash
git -C "$TEMP_DIR" rev-parse HEAD
git -C "$TEMP_DIR" status --short
```

Lo SHA deve coincidere esattamente con `DEPLOY_SHA` e lo stato deve essere
pulito.

### Dipendenze e verifiche locali

Dalla directory `v2/` del checkout temporaneo installare esclusivamente le
dipendenze determinate dal lockfile:

```bash
cd "$TEMP_DIR/v2"
npm ci
```

Non copiare `.dev.vars`, token, credenziali o altri file non tracciati nel
checkout temporaneo.

Prima del deploy eseguire almeno:

```bash
node --check src/index.mjs
node --check src/mcp/server.mjs
node --check src/mcp/task-repository.mjs
node --check src/mcp/read-repository.mjs
node --check src/mcp/task-completion-repository.mjs
node --check src/mcp/project-update-repository.mjs
node --check src/mcp/project-activity-repository.mjs
npm run verify:isolation
npm run test:unit
node scripts/verify-foundation.mjs
npm test
./node_modules/.bin/wrangler deploy --dry-run
```

Verificare inoltre:

- `git diff --check`;
- assenza di secret nel commit;
- configurazione e binding in `wrangler.jsonc`;
- identità Cloudflare e D1 mediante operazioni read-only;
- stato remoto iniziale tramite `/health`, `/ready`, discovery MCP e query SQL
  esclusivamente `SELECT`.

Dopo `npm ci` e dopo le verifiche locali, prima del deploy:

- eseguire `git status --short` nel checkout temporaneo;
- confermare che nessun file tracciato sia stato modificato;
- confermare che non esistano modifiche inattese nel checkout;
- fermarsi se il checkout non è conforme.

La directory `node_modules` generata e ignorata non costituisce di per sé una
modifica ai file tracciati.

### Deploy DEV

Il deploy richiede un’autorizzazione esplicita separata dalle verifiche locali e
dai test mutativi.

Dalla directory `v2/` del checkout temporaneo eseguire esclusivamente:

```bash
./node_modules/.bin/wrangler deploy
```

Non applicare migrazioni e non modificare binding, variabili o secret durante
questa operazione.

Registrare il Version ID restituito da Wrangler. Fermarsi se Wrangler non
restituisce un’identità di deploy coerente con `desk-v2-foundation-dev`.

### Verifiche read-only post-deploy

Prima di qualsiasi test mutativo verificare:

1. `GET /health` restituisce HTTP 200;
2. `GET /ready` restituisce HTTP 200;
3. la discovery MCP restituisce esattamente 19 tool. I 17 tool di prodotto
   sono:
   - `desk_v2_create_container`;
   - `desk_v2_move_container`;
   - `desk_v2_update_container`;
   - `desk_v2_archive_container`;
   - `desk_v2_restore_container`;
   - `desk_v2_get_containers`;
   - `desk_v2_create_task`;
   - `desk_v2_get_tasks`;
   - `desk_v2_update_task`;
   - `desk_v2_move_task`;
   - `desk_v2_resolve_reference`;
   - `desk_v2_get_briefing`;
   - `desk_v2_set_task_completion`;
   - `desk_v2_get_timeline`;
   - `desk_v2_apply_project_update`;
   - `desk_v2_get_project_activity`;
   - `desk_v2_update_project_activity`.

   I due tool esclusivamente diagnostici, non da esporre come funzionalità di
   prodotto, sono:

   - `desk_v2_capability_read`;
   - `desk_v2_capability_write`;
4. tutti i 19 schemi input/output sono validi; gli input dei tool di prodotto
   sono strict secondo i rispettivi contratti;
5. le annotations distinguono correttamente le letture dalle mutazioni. I tool
   read-only sono `desk_v2_get_containers`, `desk_v2_get_tasks`,
   `desk_v2_resolve_reference`, `desk_v2_get_briefing`,
   `desk_v2_get_timeline`, `desk_v2_get_project_activity` e il diagnostico
   `desk_v2_capability_read`;
6. i tool mutativi idempotenti espongono:

   ```text
   readOnlyHint: false
   destructiveHint: false
   idempotentHint: true
   openWorldHint: false
   ```

7. la baseline **candidata e ancora soggetta ad approvazione** di D1 contiene
   esattamente le migrazioni:

   ```text
   0001_foundation.sql
   0002_mcp_capability_test.sql
   0003_container_create_idempotency.sql
   0004_hierarchy_schema_preparation.sql
   0005_timeline_task_completion.sql
   0006_project_activity.sql
   ```

8. i conteggi reali di `containers`, `tasks`, `mcp_idempotency`,
   `mcp_capability_test`, `timeline_events`, `project_activities`,
   `project_activity_aliases`, `project_activity_items` e
   `project_activity_item_revisions` sono osservati tramite query `SELECT` e
   confrontati con la baseline pre-migrazione e pre-deploy.

Migrazioni aggiuntive o mancanti bloccano questo rilascio, salvo una nuova
approvazione esplicita. Questa condizione non costituisce un divieto permanente
di future migrazioni autorizzate.

Le query di verifica devono essere esclusivamente read-only. Non eseguire
migration, DDL, `INSERT`, `UPDATE` o `DELETE` durante questa fase.

### Primo collaudo privato ChatGPT — sola lettura

Il collaudo può iniziare soltanto dopo OAuth, migrazioni approvate, deploy e
verifiche read-only del Worker. V1 resta autorevole e l'attuale Desk Assistant
non viene modificato. Nel plugin privato abilitare inizialmente soltanto:

- `desk_v2_get_containers`;
- `desk_v2_get_tasks`;
- `desk_v2_resolve_reference`;
- `desk_v2_get_briefing`;
- `desk_v2_get_timeline`;
- `desk_v2_get_project_activity`.

Disabilitare gli 11 tool mutativi e i due diagnostici. Verificare discovery,
schemi, annotations, autenticazione e risposte read-only su dati V2 senza
scritture. L'esito del collaudo non rende V2 autorevole e non autorizza
l'abilitazione delle mutazioni.

### Test mutativi e cleanup

Il deploy non autorizza automaticamente test mutativi.

Fixture, chiamate MCP write, cleanup e qualsiasi scrittura D1 richiedono una
seconda autorizzazione esplicita. Prima di crearle documentare:

- idempotency key esatte;
- ID attesi o restituiti;
- conteggi D1 iniziali;
- ordine di creazione e cleanup;
- condizioni di arresto.

Il cleanup deve cancellare soltanto le fixture autorizzate usando ID e key
esatti. Sono vietati wildcard, prefissi, `DELETE` globali e `TRUNCATE`.

Dopo il cleanup verificare mediante `SELECT`:

- assenza individuale di ogni fixture;
- ripristino esatto dei conteggi D1 iniziali;
- assenza di record idempotenti orfani.

### Condizioni di arresto

Fermarsi immediatamente senza ulteriori mutation se:

- account, Worker, URL, D1, UUID, binding o entry point differiscono;
- lo SHA del checkout non è quello autorizzato;
- il checkout non è pulito;
- il dry-run non è PASS;
- il Version ID o l’identità restituita dal deploy sono inattesi;
- `/health` o `/ready` non restituiscono HTTP 200;
- la discovery non contiene esattamente 19 tool, distinti in 17 di prodotto e
  due diagnostici;
- `desk_v2_update_task`, `desk_v2_move_task`, i relativi schemi o annotations
  differiscono;
- OAuth non è disponibile o non supera il collaudo previsto;
- `/ready` non certifica la baseline schema candidata;
- le migrazioni `0005` e `0006` non risultano applicate e validate sul D1 DEV;
- migrazioni o conteggi D1 differiscono dalla baseline senza una spiegazione
  autorizzata;
- un test modifica dati estranei;
- il cleanup non ripristina esattamente lo stato iniziale.

Non tentare automaticamente deploy alternativi, rollback, migrazioni o cleanup
più ampi.

### Rimozione del checkout temporaneo

Conservare il checkout temporaneo fino al completamento di tutte le verifiche
post-deploy e dell’eventuale cleanup autorizzato.

Dopo la chiusura verificata del rilascio:

1. confermare nuovamente il percorso esatto del checkout;
2. accertare che non contenga modifiche o dati da conservare;
3. rimuoverlo dal repository originale con:

   ```bash
   git worktree remove "<percorso-temporaneo-esatto>"
   ```

4. verificare con `git worktree list` che sia stato rimosso.

Non usare percorsi generici, glob, variabili non verificate o cancellazioni
ricorsive manuali.

## Pubblicazione Apps Script

1. Caricare la copia pulita con `clasp push`.
2. Creare una versione Apps Script immutabile con una descrizione riconoscibile.
3. Aggiornare la distribuzione dalla console Apps Script come **Web app**:
   - versione: quella appena creata;
   - Execute as: **Me**;
   - Access: **Anyone**, perché l'autenticazione applicativa è gestita dal
     Worker tramite `DESK_API_TOKEN`.
4. Non usare `clasp deploy` o `clasp redeploy` sul deployment Web App: in questa
   configurazione possono non preservarne correttamente il tipo o l'entry point.
5. Verificare che il nuovo URL termini in `/exec` e che una richiesta GET
   restituisca `DESK API OK`. Un URL `/library/` non è una Web App.

## Allineamento Cloudflare Worker

1. Se Google ha generato un nuovo URL `/exec`, sostituire soltanto l'URL upstream
   nelle variabili del Worker e pubblicare in Production.
2. Verificare che il secret `DESK_API_TOKEN` coincida con il token della versione
   Apps Script pubblicata. Non esporre il valore in documentazione o log.
3. Non modificare routing o altri secret se non richiesto dalla release.

## Verifica obbligatoria dopo il deploy

Eseguire nell'ordine:

1. GET del Worker: deve risultare online.
2. Chiamata read-only `getProject` tramite Worker: deve restituire HTTP 200 e il
   progetto richiesto, senza `404` o `Unauthorized`.
3. Chiamata read-only `getWorkspaceBriefing` tramite Worker: deve restituire il
   briefing reale di Desk.
4. Solo dopo queste verifiche, eseguire il test funzionale mutativo da Desk
   Assistant.
5. Per una transizione di stato, controllare infine che Projects contenga il
   nuovo stato e che Timeline descriva la stessa transizione.

Il rilascio è concluso soltanto quando l'intera pipeline
`Desk Assistant → Worker → Apps Script → Google Sheets` è stata verificata.
