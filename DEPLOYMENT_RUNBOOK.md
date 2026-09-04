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

## Pre-deploy checklist

Questa checklist è obbligatoria prima di ogni rilascio. Worker, Apps Script e
schema OpenAPI devono essere verificati e pubblicati come componenti distinti.

### Cloudflare Worker

- Verificare nel file del Worker che il routing previsto dalla release sia
  presente e inoltri l'`action` corretta ad Apps Script.
- Eseguire il deploy dalla directory `worker`:

  ```bash
  npx wrangler deploy
  ```

- Annotare il nuovo Version ID restituito da Wrangler e conservarlo nelle note
  del rilascio.

### Google Apps Script

- Verificare che `.claspignore` escluda `worker/**`, affinché il codice del
  Cloudflare Worker non venga caricato nel progetto Apps Script.
- Verificare che `ApiConfig.js` non contenga il placeholder
  `CAMBIA_QUESTO_TOKEN` né un token vuoto.
- Verificare, senza stampare i valori nei log, che `DESK_API_TOKEN` in
  `ApiConfig.js` coincida con il secret `DESK_API_TOKEN` del Worker.
- Caricare la copia pulita nel progetto Apps Script:

  ```bash
  clasp push
  ```

- Creare una nuova versione immutabile con una descrizione riconoscibile:

  ```bash
  clasp version "descrizione del rilascio"
  ```

- Dalla console Apps Script, aggiornare il deployment della Web App alla nuova
  versione appena creata.
- Verificare che l'URL pubblico della Web App termini in `/exec` e rimanga
  invariato. Se Google genera un URL diverso, fermarsi e riallineare il Worker
  secondo la procedura prevista prima di continuare.

### OpenAPI

- Verificare che ogni nuova Action della release sia presente nello schema
  OpenAPI usato dal GPT.
- Verificare che endpoint e `operationId` coincidano con il routing pubblico del
  Worker.

### Collaudo

- Eseguire il test end-to-end della nuova Action sul sistema realmente
  deployato.
- Eseguire almeno un test del caso di errore previsto dal contratto, verificando
  che non produca scritture o altri effetti collaterali inattesi.
- Verificare nell'ordine che continuino a funzionare:
  - `getProject`;
  - `getWorkspaceBriefing`;
  - `updateDesk`, soltanto dopo il completamento delle verifiche read-only.

### Post-deploy

- Rimuovere eventuali dati di test creati durante il collaudo, dopo averne
  verificato con certezza origine e riferimenti.
- Annotare nelle note del rilascio la versione Apps Script, il deployment Web
  App e il Version ID del Worker effettivamente pubblicati.

> **Errori ricorrenti da evitare**
>
> 1. `clasp push` **NON** pubblica la Web App.
> 2. Dopo `clasp push` è obbligatorio:
>    - eseguire `clasp version`;
>    - aggiornare il deployment della Web App alla nuova versione.
> 3. Il Cloudflare Worker richiede sempre un deploy separato con
>    `wrangler deploy`.
> 4. Worker e Apps Script hanno cicli di deploy indipendenti.
> 5. Se compare `Unauthorized`, verificare immediatamente la corrispondenza tra
>    `DESK_API_TOKEN` del Worker e quello di `ApiConfig.js`.
> 6. Se una nuova Action cade nel flusso `updateDesk`, verificare prima il deploy
>    del Worker e poi quello della Web App.

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
