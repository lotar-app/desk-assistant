# ProjectActivity — Fase 1

## Perimetro

Cloudflare D1 è la source of truth del dominio `ProjectActivity`. Google Sheets
resta autorevole per Project e Task; Timeline resta lo storico append-only. La
Fase 1 implementa esclusivamente schema e letture. Non contiene mutazioni,
outbox delivery, fallback Timeline, ricerca semantica o briefing integration.

## Binding e database

Il Worker userà la binding `DB`. La configurazione D1 in
`worker/wrangler.jsonc` è intenzionalmente commentata: un `database_id`
segnaposto non è una binding utilizzabile e non deve compromettere il Worker
esistente. Finché la binding non viene attivata, l'endpoint risponde
`D1_NOT_CONFIGURED`.

Comandi da eseguire soltanto quando autorizzati:

```bash
cd worker
npx wrangler d1 create desk-projectactivity
# Decommentare la binding e inserire esclusivamente l'ID restituito.
npx wrangler d1 migrations apply desk-projectactivity --local
```

Il flag `--local` usa lo storage locale Wrangler. La migrazione remota richiederà
un'autorizzazione e una fase di rilascio separata.

## Schema

La migrazione `worker/migrations/0001_project_activity_foundation.sql` crea:

- `project_activities`, indice `project_id`;
- `project_activity_aliases`, PK `(project_id, alias_key)` e indice globale
  `alias_key`;
- `project_activity_items`, PK `(activity_id, item_key)` e indice
  `(activity_id, item_type)`;
- `project_activity_item_revisions`, non usata nel read path della Fase 1;
- `timeline_outbox`, non usata nel read path della Fase 1.

Il nome canonico deve essere inserito come record in
`project_activity_aliases` dalle future operazioni di scrittura.

## Normalizzazione

`normalizeActivityAlias()` applica, in quest'ordine: trim, Unicode `NFKC`,
lowercase locale-indipendente e riduzione degli spazi multipli. Non applica
fuzzy matching, stemming o ricerca semantica.

## API

Endpoint Worker:

```text
POST /project-activity
operationId: getProjectActivity
```

Input minimo per progetto noto:

```json
{
  "action": "getProjectActivity",
  "projectName": "Lotar",
  "activity": "Black Winter",
  "mode": "COMPACT"
}
```

Sono supportati `projectId + activity`, `projectName + activity`, alias globale
tramite `activity`, e `activityId` diretto. `KEYS` richiede un array non vuoto di
chiavi uniche.

### COMPACT

Usa una query dedicata che calcola la dimensione con
`length(CAST(value_json AS BLOB))`. Restituisce sempre le decisioni correnti,
ma trasferisce `value_json` di CONTENT e technical context solo quando non
supera `COMPACT_CONTENT_MAX_BYTES` (default: 2048 byte). I valori più grandi
restano nell'indice e sono recuperabili tramite `FULL` o `KEYS`.

### FULL

Restituisce il core e tutti gli item correnti. Non include Timeline o revisioni.

### KEYS

Usa una query su `(activity_id, item_key)` e restituisce esclusivamente le chiavi
richieste. Una chiave valida ma assente ha valore `null`.

## Errori

Gli errori hanno forma:

```json
{
  "success": false,
  "error": {
    "code": "ACTIVITY_NOT_FOUND",
    "message": "Project activity not found."
  }
}
```

Codici: `ACTIVITY_NOT_FOUND`, `AMBIGUOUS_ACTIVITY`, `PROJECT_NOT_FOUND`,
`INVALID_MODE`, `INVALID_KEYS`, `D1_NOT_CONFIGURED`, `INTERNAL_ERROR`.

`AMBIGUOUS_ACTIVITY` include candidati minimi senza selezionarne uno.

## Test

```bash
npm run test:project-activity
```

La suite usa repository in memoria e un recorder D1, non connessioni remote.
