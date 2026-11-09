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

### Release candidate OAuth/business-write — stato pre-deploy

La release candidate configura il Worker DEV come OAuth resource server Auth0,
con scope globali obbligatori `desk.read` e `desk.write` e profilo
`chatgpt-business-write`. Il profilo remoto registra i sei tool read-only:

- `desk_v2_get_containers`;
- `desk_v2_get_tasks`;
- `desk_v2_resolve_reference`;
- `desk_v2_get_briefing`;
- `desk_v2_get_timeline`;
- `desk_v2_get_project_activity`.

Registra inoltre gli 11 tool mutativi:

- `desk_v2_create_container`;
- `desk_v2_move_container`;
- `desk_v2_update_container`;
- `desk_v2_archive_container`;
- `desk_v2_restore_container`;
- `desk_v2_create_task`;
- `desk_v2_update_task`;
- `desk_v2_move_task`;
- `desk_v2_set_task_completion`;
- `desk_v2_apply_project_update`;
- `desk_v2_update_project_activity`.

I due tool diagnostici `desk_v2_capability_read` e
`desk_v2_capability_write` non sono registrati in alcun profilo ChatGPT. Gli
scope sono applicati globalmente al profilo business-write: tutti i 17 tool
richiedono entrambi `desk.read` e `desk.write`, inclusi i sei tool read-only.
Il profilo `chatgpt-readonly` resta implementato nel codice come possibilità di
ripristino e continua a esporre soltanto i sei tool read-only con `desk.read`.
I 19 tool completi restano utilizzati esclusivamente nei test foundation
locali, avviati con override esplicito `DESK_V2_MCP_AUTH_MODE=static` e token
casuale isolato.

Sul D1 DEV risultano applicate e validate esattamente le migrazioni
`0001`–`0006`. Sono presenti le cinque nuove tabelle introdotte da `0005` e
`0006`; `PRAGMA foreign_key_check` non segnala violazioni e gli otto conteggi
applicativi approvati sono pari a zero. La baseline applicativa comprende
`containers`, `tasks`, `mcp_idempotency`, `timeline_events`,
`project_activities`, `project_activity_aliases`, `project_activity_items` e
`project_activity_item_revisions`; `mcp_capability_test` è esclusa da questa
baseline applicativa. `/ready` verifica l'intera sequenza,
le 12 tabelle essenziali, le colonne `containers.name_key` e `containers.role`,
le foreign key e i metadata foundation; in caso positivo restituisce
`schemaVersion: 0006_project_activity`.

Il Worker remoto DEV non contiene ancora questa release. Restano bloccanti:

- verifica reale di issuer, audience/resource, JWKS, scope `desk.read` e
  `desk.write`, client pubblico PKCE e callback ChatGPT su Auth0;
- conferma che il connettore ChatGPT esistente possa richiedere entrambi gli
  scope mantenendo lo stesso Client ID, con nuova autorizzazione o
  riconnessione OAuth quando necessaria;
- corrispondenza del commit autorizzato con `origin/main`, secondo i
  prerequisiti Git seguenti;
- esecuzione con esito PASS di `wrangler deploy --dry-run` sul checkout pulito;
- autorizzazione esplicita al deploy;
- verifiche OAuth/business-write post-deploy.

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

La checklist pre-deploy deve inoltre confermare:

- tutti i test unitari previsti dalla release PASS e test foundation `5/5`
  PASS;
- migrazioni D1 remote esattamente `0001`–`0006`;
- cinque nuove tabelle presenti, zero violazioni foreign key e otto conteggi
  applicativi uguali alla baseline approvata;
- issuer e JWKS Auth0 raggiungibili, audience uguale alla resource canonica
  `/mcp` e scope `desk.read` e `desk.write` configurati;
- client Auth0 pubblico con Authorization Code e PKCE S256 e callback ChatGPT
  esatta;
- Client ID invariato e riconnessione OAuth pianificata per ottenere un token
  contenente entrambi gli scope globali;
- Version ID del Worker attualmente pubblicato registrato per un eventuale
  rollback;
- assenza di token, client secret o altre credenziali nel commit.

Le verifiche Auth0 e il dry-run non si considerano superati finché non sono
stati eseguiti e registrati sul checkout esatto autorizzato.

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

Prima del deploy registrare il Version ID attualmente pubblicato. Registrare
poi il nuovo Version ID restituito da Wrangler. Fermarsi se Wrangler non
restituisce un’identità di deploy coerente con `desk-v2-foundation-dev`.

### Verifiche OAuth/business-write post-deploy

Il primo collaudo privato ChatGPT può iniziare soltanto dopo la verifica reale
di Auth0, il deploy autorizzato e i controlli tecnici seguenti. V1 resta
autorevole e l'attuale Desk Assistant non viene modificato.

1. `GET /health` restituisce HTTP 200 e `status: alive`.
2. `GET /ready` restituisce HTTP 200 e
   `schemaVersion: 0006_project_activity`.
3. `/.well-known/oauth-protected-resource` e la variante path-aware
   `/.well-known/oauth-protected-resource/mcp` dichiarano resource canonica,
   authorization server previsto e scope globali `desk.read` e `desk.write`.
4. `/mcp` senza token e con token deliberatamente errato restituisce HTTP 401
   con challenge `WWW-Authenticate`, `resource_metadata` e richiesta di
   entrambi gli scope.
5. Token scaduti, non ancora validi, con firma, issuer, audience o scope errati
   sono rifiutati con HTTP 401. Sono rifiutati anche token contenenti soltanto
   `desk.read`, soltanto `desk.write` o nessuno dei due.
6. Un JWT Auth0 RS256 valido completa `initialize` e `tools/list`.
7. Se il connettore era già collegato con il solo `desk.read`, viene
   riconnesso o riautorizzato senza cambiare Client ID e il nuovo token contiene
   entrambi gli scope.
8. La discovery contiene esattamente i 17 tool elencati nella sezione di stato
   pre-deploy: sei read-only e 11 mutativi.
9. `desk_v2_capability_read` e `desk_v2_capability_write` sono assenti.
10. Schemi, annotations, `securitySchemes` e `_meta.securitySchemes` dei 17
    tool sono validi e richiedono entrambi `desk.read` e `desk.write`.
11. `desk_v2_archive_container` dichiara `destructiveHint: true`; tutti i tool
    mutativi conservano idempotenza e version guard previste dai rispettivi
    contratti.
12. Le sei letture rispondono sui dati V2 senza produrre scritture. Nessun tool
    mutativo viene invocato senza una seconda autorizzazione esplicita.
13. Le migrazioni restano esattamente `0001`–`0006`,
    `PRAGMA foreign_key_check` resta senza righe e gli otto conteggi applicativi
    non cambiano rispetto alla baseline pre-deploy.

Le verifiche D1 devono usare esclusivamente query `SELECT` e PRAGMA read-only.
Non eseguire migration, DDL, `INSERT`, `UPDATE` o `DELETE`. L'esito del collaudo
non rende V2 autorevole e non autorizza l'abilitazione delle mutazioni.

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
- i metadata OAuth, la challenge 401 o la discovery OIDC non coincidono con la
  configurazione approvata;
- un JWT valido non completa `initialize` oppure un token invalido è accettato;
- un token privo di `desk.read` o `desk.write` viene accettato;
- la riconnessione OAuth non produce un token con entrambi gli scope mantenendo
  il Client ID approvato;
- la discovery non contiene esattamente i 17 tool approvati, manca un tool
  atteso o espone uno dei due tool diagnostici;
- OAuth non è disponibile o non supera il collaudo previsto;
- `/ready` non certifica `0001`–`0006` con
  `schemaVersion: 0006_project_activity`;
- migrazioni o conteggi D1 differiscono dalla baseline senza una spiegazione
  autorizzata;
- `PRAGMA foreign_key_check` segnala una violazione;
- una verifica read-only produce una scrittura;
- un test modifica dati estranei;
- il cleanup non ripristina esattamente lo stato iniziale.

Non tentare automaticamente deploy alternativi, rollback, migrazioni o cleanup
più ampi.

### Rollback Worker

Se health, readiness, OAuth o discovery falliscono, interrompere il collaudo.
Soltanto dopo una nuova autorizzazione esplicita, ripristinare il Version ID
Worker precedente registrato nel pre-deploy:

```bash
./node_modules/.bin/wrangler rollback "<PREVIOUS_VERSION_ID>"
```

Il rollback Worker non modifica D1. Le migrazioni `0001`–`0006` restano
applicate e non devono essere rimosse né ripristinate tramite Time Travel per
un problema limitato al Worker. Dopo il rollback verificare nuovamente
`/health`, `/ready` e il comportamento della versione ripristinata. Il Version
ID precedente deve corrispondere alla release verificata con profilo
`chatgpt-readonly`: metadata e challenge tornano a richiedere soltanto
`desk.read`, il vecchio connettore read-only completa nuovamente `initialize` e
`tools/list`, e la discovery contiene esattamente i sei tool read-only senza
gli 11 mutativi e senza i due diagnostici. Se il connettore non riutilizza il
grant precedente, riconnetterlo richiedendo soltanto `desk.read`, senza cambiare
Client ID. Non eseguire automaticamente il rollback e non pubblicare una
versione alternativa.

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
