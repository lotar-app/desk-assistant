# Desk V2 — Release candidate OAuth/read-only

Questa directory contiene la fondazione Desk V2, i test locali e la
configurazione della release candidate DEV OAuth/read-only. Desk V1, Apps
Script, Google Sheets e Actions restano separati e non sono modificati da
questa release.

## Confini della Fase 1

- Worker: `desk-v2-foundation-dev`
- binding locale: `DESK_V2_DB`
- database logico: `desk-v2-foundation-dev`
- ambiente runtime: `v2-development`
- datastore locale: D1/Miniflare sotto una directory temporanea per ogni test
- endpoint disponibili: `GET /health` e `GET /ready`

La configurazione usa l'UUID del D1 remoto dedicato a Desk V2. Le migrazioni
`0001`–`0006` risultano applicate e validate sul D1 DEV, ma il Worker remoto DEV
non è stato ancora aggiornato con questa release. Non esiste uno script di
deploy e il controllo di isolamento rifiuta riferimenti a Desk V1 e dipendenze
runtime esterne a `v2/`.

## Comandi locali

```text
npm ci
npm run verify:isolation
npm test
```

Tutti i comandi D1 usati dalla suite includono `--local` e una directory
temporanea `--persist-to`. Nessun dato reale V1 deve essere usato come fixture.

## Stato pre-deploy della release candidate

Il Worker DEV è configurato come OAuth resource server Auth0 con scope
`desk.read` e profilo `chatgpt-readonly`. Il profilo registra esclusivamente:

- `desk_v2_get_containers`;
- `desk_v2_get_tasks`;
- `desk_v2_resolve_reference`;
- `desk_v2_get_briefing`;
- `desk_v2_get_timeline`;
- `desk_v2_get_project_activity`.

Gli 11 tool mutativi e i due diagnostici restano disabilitati. I 19 tool
completi sono utilizzati soltanto nei test foundation locali, che avviano
Wrangler con override esplicito `DESK_V2_MCP_AUTH_MODE=static` e token casuale.

Sul D1 DEV sono presenti le migrazioni `0001`–`0006` e le cinque nuove tabelle
di Timeline e ProjectActivity. La verifica registrata riporta zero violazioni
foreign key e otto conteggi applicativi pari a zero: `containers`, `tasks`,
`mcp_idempotency`, `timeline_events`, `project_activities`,
`project_activity_aliases`, `project_activity_items` e
`project_activity_item_revisions`. `mcp_capability_test` è esclusa da questa
baseline applicativa. Il Worker remoto DEV non è stato ancora distribuito con
questa configurazione; verifica Auth0, dry-run e autorizzazione al deploy
restano aperti.

## Profilo OAuth DEV e autenticazione locale dei test

La configurazione DEV imposta `DESK_V2_MCP_AUTH_MODE=oauth` e
`DESK_V2_MCP_PROFILE=chatgpt-readonly`. Il Worker opera esclusivamente come
OAuth resource server e gli altri 13 tool non compaiono in `tools/list`. Il
bearer statico non è il default DEV: viene selezionato esplicitamente soltanto
dai test foundation locali per esercitare in isolamento i 19 tool completi.

La configurazione Auth0 richiede, senza salvare secret o token nel repository:

- `DESK_V2_OAUTH_ISSUER`: issuer HTTPS esatto del tenant, incluso l'eventuale
  slash finale pubblicato nella discovery OIDC e nel claim `iss`;
- `DESK_V2_OAUTH_JWKS_URI`: endpoint JWKS HTTPS del tenant;
- `DESK_V2_MCP_CANONICAL_URL`: URL HTTPS canonico della risorsa `/mcp`;
- `DESK_V2_OAUTH_AUDIENCE`: API identifier Auth0, obbligatoriamente uguale
  all'URL canonico;
- `DESK_V2_MCP_PROFILE=chatgpt-readonly`.

Il Worker pubblica `/.well-known/oauth-protected-resource` (e la variante
path-aware `/.well-known/oauth-protected-resource/mcp`), richiede lo scope
`desk.read` e verifica JWT `RS256` tramite JWKS: firma, `kid`, issuer, audience,
`exp`, `nbf` e scope. Le risposte 401 includono una challenge
`WWW-Authenticate` con `resource_metadata`. La discovery dei tool contiene sia
`securitySchemes` sia il mirror `_meta.securitySchemes`; l'adapter è necessario
perché la versione 2.0.0 dell'SDK installata conserva `_meta` ma non serializza
il campo top-level.

La presenza delle variabili non certifica la configurazione reale del tenant o
del client Auth0, non prova il login ChatGPT e non autorizza deploy o
collegamenti.

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

`DESK_REQUIRED_MIGRATION` resta intenzionalmente `0001_foundation.sql` come
guardia legacy dell'identità foundation dell'ambiente. Non limita `/ready`, che
richiede la sequenza esatta `0001`–`0006`, le 12 tabelle essenziali, le colonne
`containers.name_key` e `containers.role`, le foreign key e i metadata attesi.
Quando tutti i controlli passano, `/ready` restituisce
`schemaVersion: 0006_project_activity`.

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

La migration `0006_project_activity.sql` aggiunge snapshot versionati,
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
