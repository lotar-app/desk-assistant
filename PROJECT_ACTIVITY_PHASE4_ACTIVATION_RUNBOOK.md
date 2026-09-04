# ProjectActivity — Fase 4: runbook di attivazione controllata

Questo documento è un piano e non autorizza creazioni, migrazioni, deploy,
scritture reali o modifiche al Custom GPT. Comandi marcati `MUTATIVO` devono
essere eseguiti solo in una successiva sessione autorizzata.

## Stato rilevabile e unknown

Baseline applicativa verificata: branch `feature/projectactivity-phase3b`,
commit `60a57d1d643f3cb4c1ac804cb2c6325ecc9b178b`. `main` e `origin/main` risultano
ancora a `0e149c0`; quindi produzione non può essere assunta uguale alla branch.

Il repository identifica il Worker `twilight-rice-7a74`, server OpenAPI
`https://twilight-rice-7a74.fastmax.workers.dev`, binding atteso `DB`, database
consigliato `desk-projectactivity`, directory migrazioni `worker/migrations`, e
uno Script Apps Script configurato in `.clasp.json`. Non contiene un
`database_id`, un deployment ID Apps Script, una versione Worker attiva, lo
stato D1 remoto o una prova della configurazione corrente del Custom GPT.

`DESK_APPS_SCRIPT_URL` e `DESK_API_TOKEN` sono richiesti dal Worker. Il token è
inviato nel body JSON verso Apps Script. I valori reali non devono essere
stampati. `.claspignore` esclude `worker/**` ma include i file JavaScript root;
`clasp push` sostituisce il contenuto remoto, quindi va usata esclusivamente una
copia pulita e controllata.

Prima del GO verificare manualmente:

- account Cloudflare, account ID, Worker attivo, version ID e route reali;
- autenticazione Wrangler e disponibilità del piano D1;
- URL e deployment/versione Apps Script attivi;
- corrispondenza del token Worker/Apps Script senza mostrarlo;
- intestazioni e numero righe reali di Timeline e stato MigrationLog;
- OpenAPI e istruzioni effettivamente salvate nel Custom GPT;
- commit realmente pubblicato in ciascun componente.

## Blocchi pre-attivazione

Lo stato corrente è **NO-GO** finché non vengono implementati e revisionati:

1. entrypoint amministrativi dedicati per `TimelineEventIdMigration`, con
   preflight, backup logico, dry-run, backup fisico, conferma forte, esecuzione
   `EXECUTION_APPROVED` e rollback. Oggi esiste solo `createManifest()` e il
   guard rifiuterebbe `mode: STRUCTURAL`;
2. un trigger Worker autenticato e limitato per invocare
   `deliverOutboxEvent`/`deliverPendingOutbox`. Le primitive non sono oggi
   raggiungibili nel Worker deployato e non esiste scheduler;
3. autenticazione inbound delle route ProjectActivity. L'OpenAPI e il Worker
   non definiscono né verificano attualmente credenziali client: la route di
   scrittura non deve essere esposta così in produzione;
4. una release candidate aggiornata: lo script esistente è specifico per
   Workspace Foundation e richiede `origin/main == release commit`;
5. una decisione su una fixture persistente: non esiste una delete API sicura
   per ProjectActivity, quindi il primo smoke non può promettere cleanup.

La correzione consigliata usa un secret inbound distinto, per esempio
`DESK_ACTIONS_TOKEN`, configurato come autenticazione bearer del Custom GPT e
validato dal Worker. Un secondo secret amministrativo o Cloudflare Access deve
proteggere la delivery manuale. Non riutilizzare automaticamente il token
Worker→Apps Script e non commettere alcun valore.

## Ordine consigliato

La sequenza più sicura è:

1. hardening locale e merge della release approvata;
2. creazione e migrazione D1, ancora non raggiungibile dal Worker attivo;
3. caricamento/versionamento/deploy Apps Script compatibile;
4. migrazione append-only Timeline `EventId`;
5. deploy Worker con binding e autenticazione;
6. smoke test tecnico;
7. aggiornamento OpenAPI/Actions;
8. aggiornamento istruzioni GPT e test manuali.

Non scegliere A: D1 mancherebbe quando il GPT o Worker iniziano a scrivere. Non
scegliere B alla lettera: pubblicare il Worker prima che sink e Timeline siano
pronti rende la delivery fallibile. La sequenza proposta sfrutta due proprietà
del codice: D1 è inerte finché non è bindato e la quinta colonna Timeline è
retrocompatibile con il vecchio codice a quattro colonne. Apps Script può
essere pubblicato prima della colonna perché il vecchio Worker non invoca il
nuovo sink; la finestra termina applicando subito la migrazione prima del Worker.

## Runbook eseguibile

### 0. Freeze e inventario — READ-ONLY

**Scopo:** fissare release e rollback.

Comandi:

```bash
git fetch --prune
git status --short
git branch --show-current
git rev-parse HEAD
git rev-parse origin/main
cd worker
npx wrangler whoami
npx wrangler deployments status --name twilight-rice-7a74
cd ..
clasp show-authorized-user
clasp list-deployments
clasp list-versions
```

Atteso: working tree con soltanto le esclusioni locali note; release commit
approvato raggiungibile da `origin/main`; identità e target corretti; versioni
attive annotate. `deployments status`/nomi comando vanno verificati contro la
versione Wrangler installata (`npx wrangler --version`). **STOP** su account,
target, branch, commit o URL inattesi. Rollback: nessuno, step read-only.

Eseguire le suite:

```bash
npm run test:project-activity
npm run test:apps-script
npm run test:gpt-instructions
ruby -e 'require "yaml"; YAML.load_file("openapi/desk-action.openapi.yaml")'
git diff --check
```

Eseguire secret scan senza stampare match/valori. **STOP** a ogni test fallito.

### 1. Hardening pre-attivazione — LOCALE, nuova review obbligatoria

**Scopo:** chiudere i cinque blocchi sopra. Aggiungere test per auth inbound,
admin delivery, migrazione Sheets end-to-end e assenza di delivery automatica.
Aggiornare OpenAPI con lo schema di sicurezza scelto. Preparare una release da
commit pulito presente su `origin/main` senza includere `ApiConfig.js` locale o
`audit/`.

Atteso: endpoint admin non accessibile senza credenziale, ProjectActivity non
accessibile anonimamente, migrazione Timeline eseguibile solo con backup e
conferma forte. **STOP** se si può mutare senza auth o bypassare il guard.
Rollback: revert del solo hardening prima di ogni deploy.

### 2. Creare D1 — MUTATIVO, autorizzazione separata

**Prerequisiti:** account Cloudflare verificato, nome libero, hardening chiuso.

```bash
cd worker
npx wrangler d1 create desk-projectactivity
```

Annotare il `database_id` restituito senza inventarlo. Inserire in
`worker/wrangler.jsonc`:

```jsonc
,"d1_databases": [{
  "binding": "DB",
  "database_name": "desk-projectactivity",
  "database_id": "<ID_REALE_RESTITUITO_DA_WRANGLER>",
  "migrations_dir": "migrations"
}]
```

Verifica read-only:

```bash
npx wrangler d1 list
npx wrangler d1 migrations list desk-projectactivity --remote
```

Atteso: database unico corretto e 0001/0002/0003 non applicate. **STOP** se il
nome risolve un DB diverso o l'ID non coincide. Rollback prima dei dati reali:
rimuovere il binding dalla release; non eliminare il DB senza autorizzazione
esplicita. Dopo dati reali non proporre mai il drop come rollback ordinario.

### 3. Migrare e verificare D1 — MUTATIVO

Prima validare localmente su storage separato:

```bash
cd worker
npx wrangler d1 migrations apply desk-projectactivity --local
npx wrangler d1 migrations list desk-projectactivity --local
```

Poi, solo con nuova autorizzazione:

```bash
npx wrangler d1 migrations apply desk-projectactivity --remote
npx wrangler d1 migrations list desk-projectactivity --remote
npx wrangler d1 execute desk-projectactivity --remote --command "SELECT name, type FROM sqlite_schema WHERE type IN ('table','index') ORDER BY type, name;"
npx wrangler d1 execute desk-projectactivity --remote --command "PRAGMA foreign_key_check;"
```

Atteso: 0001, 0002 e 0003 applicate una volta; tabelle ProjectActivity,
idempotency, revisioni e outbox presenti; inclusi gli indici
`idx_project_activities_project_id`, `idx_project_activity_aliases_alias_key`,
`idx_project_activity_items_activity_type`,
`idx_project_activity_idempotency_activity` e
`idx_timeline_outbox_pending`; foreign key check vuoto. **STOP** su errore o
schema divergente. Rollback: lasciare DB e dati intatti, non bindarlo al Worker;
correggere con una nuova migrazione forward, mai riscrivere 0001–0003.

### 4. Preparare Apps Script — MUTATIVO

**Prerequisiti:** backup del codice/versione attivi annotati; copia Git pulita
del release commit; `.claspignore` verificato; token iniettato solo nella copia
temporanea e confrontato senza output.

File funzionali nuovi/aggiornati necessari: `Api.js`,
`TimelineRepository.js`, `TimelineService.js`, `TimelineEventIdMigration.js` e
le dipendenze già presenti del framework. Poiché `clasp push` sostituisce tutto
il progetto remoto, caricare l'intero set filtrato, non singoli file.

```bash
clasp show-file-status
clasp push
clasp create-version "ProjectActivity activation <COMMIT>"
clasp list-versions
clasp list-deployments
```

Il repository impone poi l'aggiornamento manuale del deployment Web App alla
nuova versione, mantenendo lo stesso deployment e URL `/exec`, Execute as Me,
accesso Anyone. Non usare `clasp deploy`/`redeploy`. Atteso: GET `/exec` =
`DESK API OK`; `getProject` e `getWorkspaceBriefing` ancora validi. **STOP** se
l'URL cambia, l'auth fallisce o un read regredisce. Rollback: riassegnare lo
stesso deployment alla versione Apps Script precedente annotata.

### 5. Migrare Timeline EventId — MUTATIVO

**Prerequisiti:** entrypoint admin hardenizzati, intestazioni esatte `Data`,
`Project ID`, `Tipo`, `Descrizione`, MigrationLog coerente, nessuna scrittura
concorrente, autorizzazione e backup fisico verificato.

Ordine nell'editor/admin Apps Script:

1. eseguire il preflight read-only e registrare record count/header;
2. costruire il manifest e dry-run; richiedere baseline valida e una sola
   `ADD_COLUMN`, header `EventId`, posizione 5;
3. creare backup logico e `BackupEngine.createPhysical`, verificando checksum,
   spreadsheet source ID e copia;
4. presentare checksum, firma, backup ID e frase `APPLY TIMELINE_EVENT_ID_V1`;
5. solo dopo conferma separata, eseguire tramite `MigrationExecutor` con
   manifest `EXECUTION_APPROVED`;
6. verificare MigrationLog `COMPLETED`, cinque header, stesso numero di righe,
   vecchie colonne invariate ed `EventId` vuoto per le righe storiche.

**STOP** se lo schema non è esattamente legacy, il backup non coincide, il
foglio cambia dopo il dry-run o esiste già un log. Rollback: usare il piano del
framework per `DELETE_COLUMN` solo se `EventId` è ancora interamente vuoto e gli
header coincidono; dopo la prima delivery non cancellare la colonna. In quel
caso mantenere la colonna e disattivare il caller Worker.

### 6. Preparare e pubblicare Worker — MUTATIVO

**Prerequisiti:** D1 verificato; Timeline migrata; sink Apps Script attivo;
secrets configurati senza output; autenticazione inbound testata.

Prima del deploy verificare il comportamento attuale senza binding sulla
versione precedente: `getProjectActivity` deve restituire
`D1_NOT_CONFIGURED`. Configurare i secret con prompt interattivo, mai nella
command line o nei log:

```bash
cd worker
npx wrangler secret put DESK_API_TOKEN
npx wrangler secret put DESK_APPS_SCRIPT_URL
npx wrangler secret put DESK_ACTIONS_TOKEN
npx wrangler secret put PROJECT_ACTIVITY_ADMIN_TOKEN
npx wrangler deploy
```

Se URL upstream è una var non-secret, configurarla secondo la convenzione
Cloudflare approvata; non duplicarla in chiaro nel repository. Annotare version
ID. Atteso: GET Worker online, richieste anonime ProjectActivity rifiutate,
`getProject` e briefing 200 con auth corretta. **STOP** su auth, binding o
pipeline read-only non valida. Rollback: `npx wrangler rollback <VERSION_ID>`
se Cloudflare lo consente; in alternativa pubblicare il codice precedente con
binding D1 mantenuto. Non eliminare D1 né migrazioni.

### 7. Smoke test tecnico end-to-end — MUTATIVO

Usare un Project tecnico esistente approvato manualmente, non un Project
commerciale e non Black Winter. Activity: `ProjectActivity Smoke Test`; item
`test.flag = "fixture-only"`. Poiché non esiste delete activity, la fixture è
persistente e deve essere accettata prima del test.

1. `getProjectActivity` → `ACTIVITY_NOT_FOUND`;
2. create con `createIfMissing: true`, `expectedSnapshotVersion: 0` e key opaca
   registrata;
3. GET COMPACT → versione 1 e item corretto;
4. UPSERT neutro con nuova key e versione letta → versione 2;
5. ripetere lo stesso payload con la stessa key → stessa risposta/versione;
6. verificare una sola outbox row pending per la write;
7. invocare il trigger admin per `eventId` e verificare attempts 1,
   `delivered_at` valorizzato, `last_error` null;
8. ripetere delivery → nessuna chiamata/scrittura aggiuntiva e una sola riga
   Timeline con lo stesso EventId;
9. verificare descrizione leggibile e assenza di payload JSON nel foglio.

Usare richieste salvate in file temporanei con permessi 0600 oppure client che
legge la credenziale da ambiente; non mettere bearer token nella history.
**STOP** a ogni versione inattesa, duplicato Timeline o risposta ambigua.
Rollback: disattivare route/action mantenendo D1 e fixture; non improvvisare SQL
DELETE. La fixture resta nel Project tecnico e va documentata.

### 8. Custom GPT Actions — MANUALE, MUTATIVO

Caricare `openapi/desk-action.openapi.yaml`, verificare server e operationId
`getProjectActivity`/`updateProjectActivity`, configurare l'autenticazione
bearer nel pannello Actions senza inserirla nello schema o nelle istruzioni in
chiaro. `appendProjectActivityTimelineEvent` deve restare non esposto.

Prima salvare/exportare configurazione OpenAPI e auth precedenti. Atteso: test
read-only dell'Action riuscito e write marcata consequential. **STOP** se il
builder modifica/rifiuta lo schema, perde le Action esistenti o invia richieste
senza auth. Rollback: ripristinare schema e autenticazione precedenti.

### 9. Istruzioni Desk Assistant — MANUALE, MUTATIVO

Copiare integralmente il contenuto revisionato di
`gpt/DESK_ASSISTANT_INSTRUCTIONS.md`, conservando prima una copia della versione
prod corrente. Non assumere che le istruzioni online coincidano con Git.

Scenari manuali, sempre su fixture tecnica:

- brainstorming “Potremmo chiamare questa campagna X” → nessuna write;
- “Approviamo il subject approved-subject-fixture” → GET, poi CONTENT UPSERT;
- “Non più approved-subject-fixture, usiamo fixture-only” → stessa key;
- “Riprendiamo ProjectActivity Smoke Test” → snapshot, non Timeline;
- conflict stale controllato → nuova GET, massimo un retry compatibile;
- decisione che modifica anche next action → ProjectActivity più `updateDesk`;
- decisione interna senza progresso Project → solo ProjectActivity.

Atteso: nessuna creazione ambigua, nessuna Timeline scan, idempotency key
riusata nei retry. **STOP** alla prima write esplorativa o overwrite cieco.
Rollback: ripristinare le istruzioni precedenti e, se necessario, rimuovere le
due Actions ProjectActivity lasciando intatti D1 e Timeline.

## GO / NO-GO finale

GO soltanto con tutte le caselle:

- [ ] release commit approvato, pulito e presente su `origin/main`;
- [ ] test ProjectActivity, Apps Script e GPT tutti verdi;
- [ ] produzione inventariata, version ID/deployment ID precedenti annotati;
- [ ] autenticazione inbound e admin implementata e testata;
- [ ] entrypoint migrazione Timeline sicuri e revisionati;
- [ ] backup Timeline fisico verificato;
- [ ] schema pre-check Timeline esatto;
- [ ] D1 creato con ID reale e binding `DB` corretto;
- [ ] migrazioni 0001/0002/0003 e indici verificati;
- [ ] secrets Worker presenti e allineati senza esposizione;
- [ ] sink Apps Script e read pipeline verificati;
- [ ] OpenAPI valida e sink interno non esposto;
- [ ] rollback Worker, Apps Script e GPT pronto;
- [ ] fixture persistente approvata;
- [ ] nessun segreto nel repository.

Qualsiasi casella mancante significa **NO-GO**.
