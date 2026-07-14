# Prepared Update

## Scopo

Un Prepared Update e' il primo passo applicativo tra una conversazione e una futura modifica a Desk.

In questa fase Desk non viene modificato. Il sistema valida un `MemoryUpdate` e produce una preview leggibile, pronta per una futura conferma.

## Flusso

```text
Chat
  -> MemoryUpdate
  -> DeskEngine.prepareMemoryUpdate()
  -> Preview
  -> futura conferma
  -> DeskEngine.applyPreparedUpdate()
```

## `DeskEngine.prepareMemoryUpdate(memoryUpdate)`

Il metodo riceve un oggetto conforme al contratto `MemoryUpdate`.

Responsabilita':

- chiamare `MemoryUpdate.validate(memoryUpdate)`;
- interrompere il flusso con errore se l'update non e' valido;
- restituire una preview se l'update e' valido;
- non scrivere su Google Sheets;
- non applicare modifiche;
- non chiamare Repository;
- non modificare Project, Task o Timeline.

## Output

Se valido, il metodo restituisce:

```js
{
  valid: true,
  update: memoryUpdate,
  preview: {
    projectId,
    summary,
    newTasks,
    completedTasks,
    status
  }
}
```

## Significato Della Preview

La preview e' una vista ridotta dell'aggiornamento preparato.

Serve a mostrare o valutare:

- progetto coinvolto;
- sintesi dell'aggiornamento;
- task da creare;
- task da completare;
- stato progetto proposto.

La preview non e' persistenza e non rappresenta una modifica gia' applicata.

## Validazione

La validazione e' delegata a `MemoryUpdate.validate()`.

In v1 vengono verificati:

- `projectId` presente;
- `confidence` compresa tra `0` e `1`;
- `newTasks` array;
- `completedTasks` array.

La validazione non controlla ancora:

- esistenza reale del progetto;
- esistenza reale delle task completate;
- validita' dello status rispetto al dominio;
- autorizzazione o conferma di Max.

Questi controlli appartengono a fasi successive.

## Regola Fondamentale

Preparare non significa applicare.

`prepareMemoryUpdate()` deve restare una funzione senza effetti collaterali sui dati persistenti. La scrittura su Desk avverra' solo in futuro tramite `DeskEngine.applyPreparedUpdate()` dopo conferma o regole esplicite.

## Evoluzioni Future

- Persistenza degli update preparati in una Inbox aggiornamenti.
- Verifica dell'esistenza di progetto e task prima della conferma.
- Preview piu' ricca con focus, prossima azione e Timeline.
- Gestione di stati `DRAFT`, `PENDING_CONFIRMATION`, `APPLIED`, `DISCARDED`.

## Applicazione

`DeskEngine.applyPreparedUpdate(preparedUpdate)` completa il ciclo dopo la preview.

Responsabilita':

- ricevere un PreparedUpdate valido;
- validare nuovamente il `MemoryUpdate` contenuto;
- aggiornare il progetto tramite `ProjectService`;
- creare nuove task tramite `TaskService`;
- completare task tramite `TaskService`;
- registrare un evento Timeline tramite `TimelineService`;
- restituire l'esito dell'applicazione.

Output previsto:

```js
{
  success: true,
  projectId,
  updatedTasks,
  createdTasks
}
```

Campi nulli o vuoti nel `MemoryUpdate` vengono ignorati.
