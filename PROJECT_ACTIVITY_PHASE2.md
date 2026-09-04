# ProjectActivity — Fase 2

## Write contract

`POST /project-activity/update` espone `updateProjectActivity`. Il progetto non
viene mai creato: l'ID è il riferimento principale; quando è presente anche il
nome, `getProject` lo verifica. Il nome senza ID viene risolto tramite
`getProject`.

Un'attività esistente richiede `expectedSnapshotVersion` uguale alla versione
corrente. Una nuova attività richiede esattamente `0`, oltre a nome, kind,
`createIfMissing: true` e `idempotencyKey`.

## Transazione D1

Repository e service preparano tutte le differenze tramite lookup indicizzati.
La persistenza usa un solo `D1Database.batch()`, che include:

1. claim dell'idempotency key e guardia SQL sulla snapshot version;
2. activity core;
3. alias;
4. item correnti;
5. revision history;
6. una eventuale riga outbox.

Per attività esistenti, `activity_id` dell'idempotency record deriva da una
subquery che richiede la versione attesa. La colonna è `NOT NULL`: una versione
concorrente invalida fa fallire lo statement e D1 rollbacka l'intero batch.

## Versioning e idempotenza

- La creazione produce `snapshotVersion: 1`.
- Un update con almeno una differenza incrementa la versione una sola volta.
- Un NO-OP mantiene la versione e non crea outbox.
- Tutte le revisioni item della richiesta usano la nuova snapshot version.
- Il retry con stessa key e stesso hash restituisce `response_json` memorizzato.
- Stessa key e payload differente restituisce `IDEMPOTENCY_CONFLICT`.

Il request hash è SHA-256 del JSON canonico, con proprietà oggetto ordinate.
La stessa canonicalizzazione confronta semanticamente gli item: l'ordine delle
proprietà non genera revisioni artificiali.

## Patch e stable keys

`patch.set` e `patch.clear` accettano soltanto `status`, `focus`, `nextAction` e
`summary`. Un campo assente resta invariato; lo stesso campo non può apparire in
entrambe le liste. Il clear di status produce stringa vuota, gli altri clear
producono `null`, coerentemente con lo schema D1.

Gli item supportano soltanto `UPSERT` e `DELETE`:

- nuovo UPSERT: `itemRevision = 1`;
- UPSERT modificato: revisione incrementata;
- UPSERT semanticamente identico: NO-OP;
- DELETE esistente: revisione prima della rimozione;
- DELETE inesistente: NO-OP idempotente;
- DELETE richiede sempre `reason`.

Tipi: `DECISION`, `CONTENT`, `TECHNICAL_CONTEXT`.

## Alias

Gli alias usano la normalizzazione della Fase 1 e sono univoci per progetto.
Un alias già associato alla stessa attività è un NO-OP; se appartiene a un'altra
attività produce `ALIAS_CONFLICT`. Il canonical name viene sempre garantito come
alias e non può essere rimosso. Add e remove dello stesso alias nella medesima
richiesta sono rifiutati.

## Revisioni e outbox

Ogni item realmente modificato crea una riga in
`project_activity_item_revisions`, con valore precedente/nuovo, item revision,
nuova snapshot version, source, reason e idempotency key.

Ogni transazione con modifiche crea esattamente un evento
`PROJECT_ACTIVITY_CREATED` o `PROJECT_ACTIVITY_UPDATED` in `timeline_outbox`.
La delivery non appartiene alla Fase 2: `timelineDelivery` resta `PENDING`.

## Errori

Oltre agli errori read-only: `INVALID_PATCH`, `INVALID_ITEM_OPERATION`,
`INVALID_ITEM_TYPE`, `SNAPSHOT_VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT` e
`ALIAS_CONFLICT`.

## Fuori perimetro

Restano alla Fase 3: delivery e retry outbox, scritture automatiche GPT,
integrazione briefing, ricerca semantica e migrazioni dalla Timeline.
