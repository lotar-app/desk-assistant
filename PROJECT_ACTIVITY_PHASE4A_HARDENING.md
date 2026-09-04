# ProjectActivity — Fase 4A hardening

## Autenticazione Worker

Le route `POST /project-activity` e `POST /project-activity/update` richiedono
`Authorization: Bearer` verificato contro il secret runtime
`PROJECT_ACTIVITY_ACTIONS_TOKEN`. Le route amministrative richiedono invece
`PROJECT_ACTIVITY_ADMIN_TOKEN`. I token non sono intercambiabili.

Secret assente o più corto della soglia minima significa fail-closed con
`503 AUTH_NOT_CONFIGURED`; header assente, formato diverso da Bearer o valore
errato restituisce `401 UNAUTHORIZED`. Il confronto usa digest SHA-256 e non
registra né restituisce credenziali. Le route Desk legacy restano invariate.

L'OpenAPI applica lo schema bearer soltanto alle due operation ProjectActivity.
Il valore va configurato manualmente nell'editor Custom GPT come API key Bearer:
non appartiene allo YAML. Le route `/internal/**` non compaiono nello schema.

## Amministrazione outbox

- `POST /internal/project-activity/outbox/deliver`, body `{ "eventId": "..." }`;
- `POST /internal/project-activity/outbox/deliver-pending`, body opzionale
  `{ "limit": 10 }`, default 10 e massimo 100.

Le risposte contengono soltanto ID, esito, attempts, timestamp e codici errore.
Non espongono `payload_json`. Il batch pending conserva l'ordine deterministico
del repository. Queste route servono a smoke test e retry manuali; non
introducono scheduler né delivery automatica in `updateProjectActivity`.

## Timeline migration admin

`TimelineEventIdMigration` distingue `migrationType: STRUCTURAL` da
`mode: EXECUTION_APPROVED`. `MigrationSafetyGuard` non è stato modificato o
reso permissivo. L'approvazione riguarda soltanto la migration deterministica
`TIMELINE_EVENT_ID_V1`, il cui unico statement concettuale è `ADD_COLUMN` in
posizione 5.

Entry point Apps Script:

- `timelineEventIdMigrationPreflight()`;
- `timelineEventIdMigrationDryRun()`;
- `timelineEventIdMigrationCreatePhysicalBackup(folderId)`;
- `timelineEventIdMigrationApply(confirmation, physicalBackup)`;
- `timelineEventIdMigrationPostCheck(expectedRecordCount)`;
- `timelineEventIdMigrationPrepareRollback()`;
- `timelineEventIdMigrationRollback(plan, confirmation, physicalBackup)`.

Apply richiede esattamente `APPLY TIMELINE_EVENT_ID_V1`, oltre a confirmed,
migration ID, checksum, signature e backup checksum coerenti col framework.
Una seconda applicazione si ferma sullo schema non legacy e sul MigrationLog.
Il rollback richiede `ROLLBACK TIMELINE_EVENT_ID_V1` ed è preparabile/eseguibile
solo se lo schema è esattamente quello atteso e ogni cella EventId è vuota. Una
sola cella valorizzata produce `TIMELINE_EVENT_ID_ROLLBACK_NOT_SAFE`.

## Release check

Il checker read-only dedicato si esegue dalla root:

```bash
scripts/project-activity-release-check.sh <COMMIT> preparation main
```

Valida commit, working tree (ammettendo soltanto `ApiConfig.js` locale e
`audit/`), file e migrazioni, placeholder committato, suite ProjectActivity,
Apps Script e GPT, OpenAPI, SQL cumulativo, whitespace, riferimenti ai secret e
binding D1 ancora inattivo. Dopo aver inserito un database ID reale:

```bash
scripts/project-activity-release-check.sh <COMMIT> activation main
```

La modalità activation richiede binding `DB` e rifiuta il placeholder. Il
checker non crea risorse, non carica Apps Script e non esegue deploy.

## Smoke fixture persistente

- canonical name: `ProjectActivity Smoke Test`;
- kind: `INTERNAL_TEST`;
- stable key: `test.flag`;
- value: `fixture-only`;
- type: `DECISION`;
- alias aggiuntivi: nessuno;
- source type: `ACTIVATION_SMOKE_TEST`.

La fixture può restare perché è isolata, nominata esplicitamente come test e non
contiene dati commerciali. Le istruzioni GPT non devono proporla nei normali
retrieval: viene letta soltanto su riferimento esplicito al canonical name o
all'ID. Il repository non identifica con certezza un Project tecnico reale:
la scelta manuale di un Project esistente non commerciale resta prerequisito
NO-GO. Non creare automaticamente un Project e non improvvisare cleanup SQL.

## Stato

I tre blocchi tecnici del runbook sono chiusi nel codice. Il GO resta
condizionato alle verifiche remote e alle decisioni manuali elencate nel runbook:
Project tecnico della fixture, valori secret, account/target, backup reale e
versioni di rollback. Nessuna attivazione è stata eseguita in Fase 4A.
