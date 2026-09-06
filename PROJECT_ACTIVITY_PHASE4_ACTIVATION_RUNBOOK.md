# ProjectActivity — Fase 4: runbook di attivazione controllata

Questo documento conserva il piano eseguito e le relative salvaguardie; non
costituisce autorizzazione per nuove mutazioni. L'attivazione descritta è stata
completata fino al Gate 9. Qualsiasi operazione futura marcata `MUTATIVO`
richiede una nuova autorizzazione esplicita.

## Stato finale dell'attivazione

ProjectActivity è attivo in produzione. Baseline applicativa e istruzioni di
produzione: `10b03207591e5eaf87eeb8cc66f961f2691db672`, raggiungibile da
`origin/main`. La baseline funzionale storica dello split Timeline resta
`1cb122ed9e582b9600377886d98a6ae53bdbc235`; il safeguard Git registrato è
`438ea09251835e3b3255e636a21ca51f3a96f1d2`.

Stato verificato:

- D1 `desk-projectactivity`, ID
  `72660130-74f3-4082-8b9d-4be77d5464ea`, con migrazioni 0001–0003 applicate;
- Apps Script versione 27 e registro `ProjectActivityTimelineDelivery` attivo
  tramite `PROJECT_ACTIVITY_TIMELINE_DELIVERY_V1`;
- Worker production version
  `4edc6eff-8cd6-4e7d-9887-82a852d6a806`;
- Gate 7 E2E PASS: outbox, Timeline e registro verificati senza duplicati. Il
  difetto di binding del `fetch` nativo è stato corretto dal commit
  `9c41f011dfc6b52047d3c446900f32e61d80e82a`;
- Gate 8 PASS: sei Actions attive (`updateDesk`, `getProject`,
  `getProjectTasks`, `getProjectActivity`, `updateProjectActivity`,
  `getWorkspaceBriefing`), bearer Actions configurato e credenziale Admin non
  esposta al GPT. Il fix di compatibilità del parser schema è
  `156b9a69d17c85d7c8344a1237ec18eb055331d1`;
- Gate 9 PASS: pubblicato integralmente
  `gpt/DESK_ASSISTANT_INSTRUCTIONS.md` (7.400 caratteri Unicode, 7.424 byte
  UTF-8, 67 righe). In nuova chat sono passati exact `Desk`, disponibilità
  Actions cross-chat, lettura ProjectActivity e legacy `getProject`;
- verificati inoltre stale `SNAPSHOT_VERSION_CONFLICT` con rilettura e massimo
  un safe retry, `IDEMPOTENCY_CONFLICT` senza bypass, write internal-only senza
  `updateDesk`, dual write ProjectActivity + `updateDesk`, revoca esplicita e
  task listing tramite Action senza write;
- il rendering dei marker Markdown delle task resta un limite prompt-only
  accettato e non bloccante: non è una garanzia del runtime;
- fixture persistente `ProjectActivity Smoke Test`, ID
  `ACT-d134baad-01da-41ef-8468-432e2df408d8`: stato finale effettivo
  snapshotVersion 6, `test.flag` assente dopo revoca esplicita. Non ripristinare
  `fixture-only`;
- cleanup sicurezza completato: la directory temporanea
  `/private/tmp/desk-pa-gate7.srwRqi` e le copie client dei token sono assenti;
  nessun valore è stato esposto durante il cleanup.

## Stato rilevabile e verifiche completate

Baseline funzionale iniziale verificata: branch
`feature/projectactivity-timeline-schema-fix`, commit
`1cb122ed9e582b9600377886d98a6ae53bdbc235`. L'eventuale commit documentale
successivo costituisce il release commit finale senza modificare questa
baseline funzionale. Al precheck precedente `main` e `origin/main` erano ancora
a `0e149c0`; il Gate 0 era bloccato soltanto perché la release non era ancora
stata integrata nel remoto.

La baseline iniziale identificava il Worker `twilight-rice-7a74`, server OpenAPI
`https://twilight-rice-7a74.fastmax.workers.dev`, binding atteso `DB`, database
consigliato `desk-projectactivity`, directory migrazioni `worker/migrations`, e
uno Script Apps Script configurato in `.clasp.json`. In quella fase il
repository non conteneva ancora il `database_id` reale e non costituiva prova
del deployment Apps Script, della versione Worker attiva, dello stato D1 remoto
o della configurazione del Custom GPT; tali evidenze sono ora registrate nello
stato finale sopra.

`DESK_APPS_SCRIPT_URL` e `DESK_API_TOKEN` sono richiesti dal Worker. Il token è
inviato nel body JSON verso Apps Script. I valori reali non devono essere
stampati. `.claspignore` esclude `worker/**` ma include i file JavaScript root;
`clasp push` sostituisce il contenuto remoto, quindi va usata esclusivamente una
copia pulita e controllata.

Il 2026-09-04 Max ha completato sullo Spreadsheet Desk live l'audit dei
consumer Timeline: nessun foglio nascosto, named range, trigger installabile,
foglio/intervallo protetto o pivot su alcun foglio; nessuna formula visibile o
convalida dati sulla Timeline; nessun oggetto o grafico visibile sulla Timeline;
nessun consumer esterno noto di Desk/Timeline. Il filtro Timeline è rimasto
invariato. Il gate architetturale del rollout transizionale è quindi
tecnicamente GO.

Le seguenti verifiche erano richieste prima dell'attivazione e risultano ora
completate; l'elenco resta come traccia del preflight:

- account Cloudflare, account ID, Worker attivo, version ID e route reali;
- autenticazione Wrangler e disponibilità del piano D1;
- URL e deployment/versione Apps Script attivi;
- corrispondenza del token Worker/Apps Script senza mostrarlo;
- intestazioni e numero righe reali di Timeline e stato MigrationLog;
- OpenAPI e istruzioni effettivamente salvate nel Custom GPT;
- commit realmente pubblicato in ciascun componente.

## Blocchi pre-attivazione

I blocchi seguenti sono stati implementati in Fase 4A e devono essere verificati
dal checker e dalla review prima del GO:

1. entrypoint amministrativi per la migration del registro delivery separato;
2. un trigger Worker autenticato e limitato per invocare
   `deliverOutboxEvent`/`deliverPendingOutbox`; non è stato introdotto uno
   scheduler automatico;
3. autenticazione inbound delle route ProjectActivity tramite secret Actions;
4. checker release ProjectActivity read-only in
   `scripts/project-activity-release-check.sh`;
5. una decisione su una fixture persistente: non esiste una delete API sicura
   per ProjectActivity, quindi il primo smoke non può promettere cleanup.

I secret scelti sono `PROJECT_ACTIVITY_ACTIONS_TOKEN` e
`PROJECT_ACTIVITY_ADMIN_TOKEN`. Restano separati da `DESK_API_TOKEN` e non
devono essere committati.

## Ordine consigliato

La sequenza più sicura è:

1. hardening locale e merge della release approvata;
2. creazione e migrazione D1, ancora non raggiungibile dal Worker attivo;
3. caricamento/versionamento/deploy Apps Script backward-compatible;
4. creazione del foglio tecnico `ProjectActivityTimelineDelivery`;
5. verifica dei consumer e smoke dello split transizionale: Desk legacy A-D,
   ProjectActivity canonico A-G;
6. deploy Worker con binding e autenticazione;
7. smoke test tecnico;
8. aggiornamento OpenAPI/Actions;
9. aggiornamento istruzioni GPT e test manuali.

Non scegliere A: D1 mancherebbe quando il GPT o Worker iniziano a scrivere. Non
scegliere B alla lettera: pubblicare il Worker prima che sink e registro siano
pronti rende la delivery fallibile. D1 resta inerte finché non è bindato. Non è
prevista alcuna riscrittura dello storico né una colonna EventId in Timeline.

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

File funzionali nuovi/aggiornati necessari: `Api.js`, `TimelineRepository.js`,
`TimelineService.js`, `ProjectActivityTimelineDeliveryRepository.js`, migration
e admin del registro, più le dipendenze già presenti del framework. Poiché `clasp push` sostituisce tutto
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

### 5. Creare il registro delivery — MUTATIVO

**Prerequisiti:** backup Spreadsheet verificato, entrypoint admin pubblicati,
registro assente, MigrationLog coerente e autorizzazione esplicita.

Ordine nell'editor/admin Apps Script:

1. eseguire `projectActivityTimelineDeliveryMigrationPreflight`;
2. eseguire il dry-run; richiedere una sola `CREATE_SHEET`;
3. creare backup logico e `BackupEngine.createPhysical`, verificando checksum,
   spreadsheet source ID e copia. L'entrypoint
   `projectActivityTimelineDeliveryMigrationCreatePhysicalBackup` registra in
   `DocumentProperties` un solo receipt tecnico per migration, dopo la verifica
   del backup. Un backup creato da una versione precedente priva del receipt
   non è selezionabile automaticamente e deve essere ricreato dopo il deploy
   dell'adapter amministrativo;
4. presentare checksum, firma, backup ID e frase
   `APPLY PROJECT_ACTIVITY_TIMELINE_DELIVERY_V1`;
5. solo dopo conferma separata, eseguire dall'editor l'entrypoint senza
   argomenti `projectActivityTimelineDeliveryMigrationApplyApproved`. Il
   wrapper richiede esattamente un receipt, verifica nuovamente migration ID,
   source Spreadsheet, checksum, copia Spreadsheet e XLSX, costruisce la
   confirmation completa con la phrase esatta e delega alla funzione core e a
   `MigrationExecutor` con manifest `EXECUTION_APPROVED`;
6. verificare MigrationLog `COMPLETED`, header del registro esatti e zero righe
   delivery. Timeline e storico devono essere invariati.

**STOP** se il backup non coincide, il foglio compare dopo il dry-run o esiste
già un log. Rollback: eliminare il solo foglio tecnico tramite framework
esclusivamente se non contiene righe; dopo la prima delivery mantenerlo e
disattivare il caller Worker.

L'entrypoint di apply scrive nel log di esecuzione soltanto un report tecnico
con migration ID, outcome, operation ID e stato/header del registry; non
include receipt, checksum, ID dei file di backup, token o payload applicativi.

La release transizionale mantiene Project, Task, memory event e `updateDesk`
sul writer legacy a quattro valori. Solo ProjectActivity usa il writer canonico
a sette colonne. Il parser interno accetta entrambe le forme nello stesso
foglio. Non attivare il writer canonico globale: il rollout approvato mantiene
lo split transizionale. Pivot e consumer esterni sono stati verificati
manualmente senza rilevare dipendenze. Nessuna riscrittura storica è
autorizzata.

### 6. Preparare e pubblicare Worker — MUTATIVO

**Prerequisiti:** D1 verificato; registro delivery creato; sink Apps Script attivo;
secrets configurati senza output; autenticazione inbound testata.

Prima del deploy verificare il comportamento attuale senza binding sulla
versione precedente: `getProjectActivity` deve restituire
`D1_NOT_CONFIGURED`. Configurare i secret con prompt interattivo, mai nella
command line o nei log:

```bash
cd worker
npx wrangler secret put DESK_API_TOKEN
npx wrangler secret put DESK_APPS_SCRIPT_URL
npx wrangler secret put PROJECT_ACTIVITY_ACTIONS_TOKEN
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

**Completato — PASS.** La fixture finale è a snapshotVersion 6 e
`test.flag` è assente dopo la revoca esplicita; i passi seguenti descrivono la
sequenza di attivazione, non lo stato finale da ripristinare.

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
   Timeline; l'EventId resta nel registro tecnico, non in Timeline.ID;
9. verificare descrizione leggibile e assenza di payload JSON nel foglio.

Usare richieste salvate in file temporanei con permessi 0600 oppure client che
legge la credenziale da ambiente; non mettere bearer token nella history.
**STOP** a ogni versione inattesa, duplicato Timeline o risposta ambigua.
Rollback: disattivare route/action mantenendo D1 e fixture; non improvvisare SQL
DELETE. La fixture resta nel Project tecnico e va documentata.

### 8. Custom GPT Actions — MANUALE, MUTATIVO

**Completato — PASS.** Le sei Actions previste sono attive; auth Actions e
separazione dalla credenziale Admin sono state verificate. `getProjectActivity`
e legacy `getProject` hanno superato il controllo post-save.

Caricare `openapi/desk-action.openapi.yaml`, verificare server e operationId
`getProjectActivity`/`updateProjectActivity`, configurare l'autenticazione
bearer nel pannello Actions senza inserirla nello schema o nelle istruzioni in
chiaro. `appendProjectActivityTimelineEvent` deve restare non esposto.

Prima salvare/exportare configurazione OpenAPI e auth precedenti. Atteso: test
read-only dell'Action riuscito e write marcata consequential. **STOP** se il
builder modifica/rifiuta lo schema, perde le Action esistenti o invia richieste
senza auth. Rollback: ripristinare schema e autenticazione precedenti.

### 9. Istruzioni Desk Assistant — MANUALE, MUTATIVO

**Completato — PASS.** L'artifact pubblicato è
`gpt/DESK_ASSISTANT_INSTRUCTIONS.md` al release commit
`10b03207591e5eaf87eeb8cc66f961f2691db672`; le validazioni manuali finali
sono registrate nello stato finale sopra.

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

- [x] release commit approvato, pulito e presente su `origin/main`;
- [x] test ProjectActivity, Apps Script e GPT tutti verdi;
- [x] produzione inventariata, version ID/deployment ID precedenti annotati;
- [x] autenticazione inbound e admin implementata e testata;
- [x] entrypoint migration registro delivery sicuri e revisionati;
- [x] backup Timeline fisico verificato;
- [x] schema Timeline reale, pivot e consumer esterni verificati;
- [x] registro `ProjectActivityTimelineDelivery` creato e vuoto al post-check;
- [x] D1 creato con ID reale e binding `DB` corretto;
- [x] migrazioni 0001/0002/0003 e indici verificati;
- [x] secrets Worker presenti e allineati senza esposizione;
- [x] sink Apps Script e read pipeline verificati;
- [x] OpenAPI valida e sink interno non esposto;
- [x] rollback Worker, Apps Script e GPT pronto;
- [x] fixture persistente approvata e stato finale documentato;
- [x] nessun segreto nel repository e copie client temporanee eliminate.

Esito finale: **GO — attivazione completata e validata fino al Gate 9**.
