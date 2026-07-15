# Procedura sicura di rilascio Desk Assistant

Questa procedura va letta prima di ogni aggiornamento di Apps Script o del
Cloudflare Worker.

## Prima del rilascio

1. Verificare che il commit da pubblicare sia quello corretto e sia presente su
   `origin/main`.
2. Se il working tree contiene modifiche non correlate, preparare il deploy da
   una copia temporanea pulita del commit. Non eseguire `clasp push` direttamente
   da un working tree sporco.
3. Eseguire i test pertinenti. Per cambi di stato, verificare insieme il valore
   salvato in Projects e il relativo evento Timeline.
4. Non salvare token reali nel repository e non distribuire
   `CAMBIA_QUESTO_TOKEN` o un token vuoto. Prima di creare la versione Apps
   Script, verificare che la configurazione di deploy contenga il token previsto
   dal Worker, senza stamparlo nei log.

## Pubblicazione Apps Script

1. Caricare la copia pulita con `clasp push`.
2. Creare una versione Apps Script immutabile con una descrizione riconoscibile.
3. Aggiornare la distribuzione dalla console Apps Script come **Web app**:
   - versione: quella appena creata;
   - Execute as: **Me**;
   - Access: **Anyone**, perché l'autenticazione applicativa è gestita dal
     Worker tramite `DESK_API_TOKEN`.
4. Non usare `clasp deploy` o `clasp redeploy` sul deployment Web App: in questa
   configurazione possono non preservarne correttamente il tipo o l'entry point.
5. Verificare che il nuovo URL termini in `/exec` e che una richiesta GET
   restituisca `DESK API OK`. Un URL `/library/` non è una Web App.

## Allineamento Cloudflare Worker

1. Se Google ha generato un nuovo URL `/exec`, sostituire soltanto l'URL upstream
   nelle variabili del Worker e pubblicare in Production.
2. Verificare che il secret `DESK_API_TOKEN` coincida con il token della versione
   Apps Script pubblicata. Non esporre il valore in documentazione o log.
3. Non modificare routing o altri secret se non richiesto dalla release.

## Verifica obbligatoria dopo il deploy

Eseguire nell'ordine:

1. GET del Worker: deve risultare online.
2. Chiamata read-only `getProject` tramite Worker: deve restituire HTTP 200 e il
   progetto richiesto, senza `404` o `Unauthorized`.
3. Chiamata read-only `getWorkspaceBriefing` tramite Worker: deve restituire il
   briefing reale di Desk.
4. Solo dopo queste verifiche, eseguire il test funzionale mutativo da Desk
   Assistant.
5. Per una transizione di stato, controllare infine che Projects contenga il
   nuovo stato e che Timeline descriva la stessa transizione.

Il rilascio è concluso soltanto quando l'intera pipeline
`Desk Assistant → Worker → Apps Script → Google Sheets` è stata verificata.
