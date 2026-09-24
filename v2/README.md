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

## Non incluso

Actions, OpenAPI V2, Container/Task service operativo, Timeline,
ProjectActivity, briefing, compatibility V1, migrazione V1 e backup automatici
sono rimandati a fasi successive.
