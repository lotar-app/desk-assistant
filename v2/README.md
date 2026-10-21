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

## Non incluso

Actions, OpenAPI V2, Container/Task service operativo, Timeline,
ProjectActivity, briefing, compatibility V1, migrazione V1 e backup automatici
sono rimandati a fasi successive.
