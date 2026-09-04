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

## Timeline migration correction

Il preflight reale ha invalidato `TIMELINE_EVENT_ID_V1`: la migration è ora
superseded e il suo entrypoint manifesto fallisce sempre. Non aggiungere
`EventId` alla Timeline. `PROJECT_ACTIVITY_TIMELINE_DELIVERY_V1` crea invece un
foglio tecnico separato, mantenendo `MigrationSafetyGuard` invariato.

I nuovi entrypoint Apps Script sono:

- `projectActivityTimelineDeliveryMigrationPreflight()`;
- `projectActivityTimelineDeliveryMigrationDryRun()`;
- `projectActivityTimelineDeliveryMigrationCreatePhysicalBackup(folderId)`;
- `projectActivityTimelineDeliveryMigrationApply(confirmation, physicalBackup)`;
- `projectActivityTimelineDeliveryMigrationPostCheck()`;
- `projectActivityTimelineDeliveryMigrationPrepareRollback()`.

Apply richiede esattamente
`APPLY PROJECT_ACTIVITY_TIMELINE_DELIVERY_V1`. Il rollback strutturale è
consentito soltanto finché il registro è vuoto; dopo una delivery il foglio va
preservato.

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
all'ID. Max ha approvato il Project tecnico `Desk - Gestione task API`, ID
`PRJ-20260720130424`. Non creare automaticamente un Project e non improvvisare
cleanup SQL.

## Stato

I tre blocchi tecnici del runbook sono chiusi nel codice. Il GO resta
condizionato alle verifiche remote e alle decisioni manuali elencate nel runbook:
Project tecnico della fixture, valori secret, account/target, backup reale e
versioni di rollback. Nessuna attivazione è stata eseguita in Fase 4A.
