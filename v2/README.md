# Desk V2 — Foundation locale

Questa directory contiene esclusivamente la fondazione locale di Desk V2.
Desk V1, Apps Script, Google Sheets, Actions e le risorse Cloudflare remote non
fanno parte di questa fase.

## Confini della Fase 1

- Worker: `desk-v2-foundation-dev`
- binding locale: `DESK_V2_DB`
- database logico: `desk-v2-foundation-dev`
- ambiente runtime: `v2-development`
- datastore locale: D1/Miniflare sotto una directory temporanea per ogni test
- endpoint disponibili: `GET /health` e `GET /ready`

La configurazione usa l'UUID del D1 remoto dedicato a Desk V2; nessuna migration
remota è inclusa in questa fase. Non esiste uno script di deploy e il controllo
di isolamento rifiuta riferimenti a Desk V1, binding remoti e dipendenze runtime
esterne a `v2/`.

## Comandi locali

```text
npm ci
npm run verify:isolation
npm test
```

Tutti i comandi D1 usati dalla suite includono `--local` e una directory
temporanea `--persist-to`. Nessun dato reale V1 deve essere usato come fixture.

## Stato della release candidate STEP 33J

Il codice locale registra 19 tool MCP: 17 tool di prodotto e i diagnostici
`desk_v2_capability_read` e `desk_v2_capability_write`. Questa è una baseline
candidata, non un'autorizzazione al rilascio. OAuth non è implementato, le
migrazioni `0005` e `0006` non risultano applicate al D1 DEV, il Worker con
questa baseline non risulta deployato e il collaudo ChatGPT non è stato
eseguito.

Il primo collaudo ChatGPT dovrà mantenere V1 autorevole ed esporre soltanto i
sei tool read-only `desk_v2_get_containers`, `desk_v2_get_tasks`,
`desk_v2_resolve_reference`, `desk_v2_get_briefing`,
`desk_v2_get_timeline` e `desk_v2_get_project_activity`. Gli 11 tool mutativi e
i due diagnostici resteranno disabilitati.

## Preparazione gerarchica (migration 0004)

La migration additiva `0004_hierarchy_schema_preparation.sql` aggiunge le
colonne nullable `containers.name_key` e `containers.role` e prepara la tabella
singleton vuota `desk_hierarchy`. Non crea root o aree, non esegue backfill e
non applica ancora l'unicità dei nomi tra fratelli.

La normalizzazione futura di `name_key`, in versione iniziale `1`, segue questo
contratto: trim, Unicode NFKC, sostituzione di ogni sequenza di whitespace
Unicode con un singolo spazio, Unicode case folding indipendente dalla locale e
rifiuto del risultato vuoto. `lower(trim(name))` di SQLite non è un sostituto
valido del case folding Unicode completo.

`DESK_REQUIRED_MIGRATION` resta intenzionalmente `0001_foundation.sql`: nella
semantica runtime corrente rappresenta la migration foundation minima richiesta
dalla readiness, non l'ultima migration applicata.

## Timeline e completamento Task (migration 0005)

La migration `0005_timeline_task_completion.sql` aggiunge la Timeline V2
append-only. Ogni evento conserva Container, Task opzionale, tipo, descrizione,
origine, timestamp e riferimento alla ricevuta idempotente. Trigger SQL vietano
UPDATE e DELETE degli eventi.

`desk_v2_set_task_completion` usa gli stati già presenti nel modello: COMPLETE
imposta `DONE` e `completed_at`, mentre REOPEN imposta `OPEN` e azzera
`completed_at`. Solo le transizioni reali producono un evento, nella stessa
batch atomica della Task e della ricevuta idempotente.

`desk_v2_get_timeline` legge eventi con scope Container o Task esplicito; una
lettura globale richiede `global: true`. La Timeline non sostituisce la memoria
ProjectActivity.

`desk_v2_apply_project_update` coordina in una sola batch D1 la patch dei campi
supportati di un Container/Project esistente, la creazione di Task, le
transizioni COMPLETE/REOPEN, la ricevuta idempotente e un singolo evento
Timeline. Un aggiornamento senza mutazioni di dominio conserva la ricevuta ma
non incrementa versioni e non crea eventi. Il tool non crea Project impliciti e
non legge o scrive ProjectActivity.

## ProjectActivity (migration 0006)

La migration locale `0006_project_activity.sql` aggiunge snapshot versionati,
alias esatti normalizzati secondo il contratto V1 approvato, item a stable key
e revisioni immutabili. `desk_v2_get_project_activity` legge lo snapshot
corrente in modalità `COMPACT`, `FULL` o `KEYS`; la risoluzione globale per
alias è consentita solo se richiesta esplicitamente e se univoca.

`desk_v2_update_project_activity` crea memoria soltanto con
`createIfMissing: true` su un Project esistente e attivo. Patch, alias, item,
revisioni, ricevuta idempotente e un singolo evento Timeline per mutazione
reale sono inclusi nella stessa batch. Un NO-OP mantiene la versione e non
crea eventi. Timeline e revisioni sono audit: non sostituiscono mai lo snapshot
corrente.

## Non incluso

Actions, OpenAPI V2, compatibility V1, migrazione V1
e backup automatici sono rimandati a fasi successive. Il runtime locale espone
un resolver esatto per Container e Task e un briefing limitato a uno scope
Container esplicito; non assumono Workspace o ProjectActivity.
