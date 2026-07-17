# Workspace Migration — Execution Package

## Stato e confini

- Migration ID: `WORKSPACE_FOUNDATION_V1`
- Versione: `1.0.0`
- Stato: `EXECUTION_READY`
- Fingerprint congelato: `130705eba6afcab2793f54d3d0a4377c07344f4b2fdd4693951cfc32a7d1e29d`
- Algoritmo: SHA-256 del JSON canonico prodotto da
  `WorkspaceMigration.fingerprintPayload()`.

Questo pacchetto non autorizza backup, migrazione o deployment. Ogni checkpoint
richiede una risposta esplicita dell'utente.

## A. Manifesto congelato

### Workspace

| ID | Name | IsDefault | Status |
|---|---|---:|---|
| `WS0001` | `LOTAR` | `true` | `ACTIVE` |
| `WS0002` | `CLIENTI` | `false` | `ACTIVE` |

### Alias

| Alias | WorkspaceID |
|---|---|
| `Lotar` | `WS0001` |
| `Freelance` | `WS0002` |
| `Clienti` | `WS0002` |

`La Sfinge` e `Tuscanpledges` sono progetti di `CLIENTI`; non sono alias. La
classificazione è una decisione approvata e non è dedotta dai nomi.

### Mapping ProjectID → WorkspaceID

```text
PRJ-20260716142952 -> WS0002
PRJ-20260716141419 -> WS0002
PRJ-20260716121441 -> WS0001
PRJ-20260710095800 -> WS0001
PRJ-20260716103301 -> WS0001
PRJ-20260716091407 -> WS0001
PRJ-20260716080119 -> WS0001
PRJ-20260709095234 -> WS0001
PRJ-20260708130248 -> WS0001
PRJ-20260710130212 -> WS0001
PRJ-20260714130206 -> WS0001
```

### Operazioni congelate

Nell'ordine:

1. `ADD_COLUMN Projects.WorkspaceID`, posizione 9;
2. `CREATE_SHEET Workspaces`, header `ID`, `Name`, `IsDefault`, `Status`,
   `CreatedAt`, `UpdatedAt`;
3. `CREATE_SHEET WorkspaceAliases`, header `Alias`, `WorkspaceID`, `CreatedAt`;
4. creazione dei due workspace;
5. creazione dei tre alias;
6. aggiornamento degli 11 progetti in ordine alfabetico di Project ID.

Totale: 19 operazioni, di cui 3 strutturali, 2 workspace, 3 alias e 11
assegnazioni.

## B. Fingerprint

Eseguire dall'editor Apps Script `workspaceMigrationShowFingerprint`. Il valore
deve coincidere esattamente con quello indicato all'inizio del documento.

Il payload comprende Migration ID, versione, stato, timestamp congelato,
workspace, default, status, alias, mapping e lista ordinata completa delle
operazioni strutturali. `MigrationUtils.canonicalize()` ordina le chiavi degli
oggetti e preserva l'ordine degli array; `MigrationUtils.checksum()` applica
SHA-256. Non sono inclusi Settings, token, URL o credenziali.

Il fingerprint del nucleo congelato è distinto dal checksum del manifesto
eseguibile: quest'ultimo include anche i conteggi della baseline reale e viene
calcolato soltanto dopo un preflight valido.

Stop immediato se il fingerprint differisce. Non rigenerare un valore di
riferimento senza una nuova approvazione formale del manifesto.

## C. Preflight manuale, un passaggio alla volta

Comunicare soltanto intestazioni, conteggi e ID tecnici. Non comunicare valori
di Settings, token, password o URL con credenziali.

### Passaggio 1 — Identità del file

- Aprire nel browser il Google Sheet che si ritiene usato da Desk.
- Comunicare: solo il titolo del file e data/ora del controllo.
- Atteso: identità concordata del database Desk.
- Stop: qualsiasi dubbio sul file oppure modifiche concorrenti.

### Passaggio 2 — Elenco fogli

- Aprire il menu dei fogli e verificare anche quelli nascosti.
- Comunicare: nomi e visibilità dei tab.
- Atteso almeno: `Projects`, `Tasks`, `Timeline`, `Settings`; `Workspaces` e
  `WorkspaceAliases` assenti.
- Stop: fogli Workspace presenti, nomi quasi duplicati o fogli inattesi non
  spiegabili.

### Passaggio 3 — Header Projects

- Aprire `Projects` e leggere A1:H1, poi I1.
- Comunicare: gli header nell'ordine, senza contenuti delle righe.
- Atteso A:H: `ID`, `Progetto`, `Status`, `Focus`, `Responsabile`,
  `Prossima azione`, `Creato il`, `Ultimo aggiornamento`; I1 assente/vuoto.
- Stop: differenza anche di un solo header, `WorkspaceID` già presente,
  formule, colonne o righe chiave nascoste.

### Passaggio 4 — Project ID

- In `Projects`, leggere esclusivamente la colonna `ID` e contare le righe.
- Comunicare: conteggio e lista degli ID.
- Atteso: esattamente gli 11 ID del mapping, una volta ciascuno.
- Stop: ID vuoto, duplicato, mancante o inatteso.

### Passaggio 5 — Header e ID Tasks

- Aprire `Tasks`; leggere A1:K1 e la sola colonna `ID`.
- Comunicare: header, numero righe, eventuali ID duplicati e soltanto i
  `ProjectID` orfani.
- Atteso header: `ID`, `ProjectID`, `Title`, `Description`, `Status`,
  `Priority`, `Assignee`, `DueDate`, `CreatedAt`, `UpdatedAt`, `CompletedAt`;
  nessun ID vuoto/duplicato e nessun riferimento orfano.
- Stop: schema diverso, ID vuoti/duplicati, ProjectID orfani.

### Passaggio 6 — Timeline

- Aprire `Timeline`; leggere A1:D1 e controllare la colonna `Project ID`.
- Comunicare: header, conteggio e soli riferimenti orfani.
- Atteso: `Data`, `Project ID`, `Tipo`, `Descrizione`; nessun orfano.
- Stop: schema diverso o riferimento orfano.

### Passaggio 7 — Settings

- Aprire `Settings` e leggere soltanto gli header.
- Comunicare: esclusivamente gli header e il numero di righe.
- Atteso: `Key`, `Value`.
- Stop: per verificare sarebbe necessario mostrare un valore sensibile oppure
  lo schema è diverso. Non copiare mai il contenuto della colonna `Value`.

### Passaggio 8 — MigrationLog

- Verificare se esiste `MigrationLog`.
- Se presente, leggere header e cercare solo il Migration ID
  `WORKSPACE_FOUNDATION_V1`.
- Comunicare: presenza, header, numero di righe per quel Migration ID e stati;
  non comunicare Before/After.
- Atteso: foglio assente oppure header standard e zero righe per il Migration ID.
- Stop: record già presente, header incompatibili o checksum/log sospetti.

### Passaggio 9 — Esito

- Comunicare una tabella PASS/FAIL per gli otto passaggi.
- Atteso: tutti PASS.
- Stop: anche un solo FAIL. Non correggere dati durante il preflight.

## D. Funzioni amministrative

| Funzione | Effetto nello stato attuale |
|---|---|
| `workspaceMigrationShowFingerprint()` | read-only, non accede ai fogli |
| `workspaceMigrationRunPreflight()` | read-only, report senza valori Settings |
| `workspaceMigrationBuildPlan()` | read-only, piano e checksum sintetici |
| `workspaceMigrationRunDryRun()` | snapshot logico in memoria e dry run; nessuna scrittura |
| `workspaceMigrationRunSafeRuntimeTests()` | fixture in memoria, nessun dato reale |
| `workspaceMigrationExecute(...)` | rifiuta perché lo stato è `EXECUTION_READY` |
| `workspaceMigrationPrepareRollback()` | rifiuta perché lo stato è `EXECUTION_READY` |
| `workspaceMigrationRollback(...)` | rifiuta perché lo stato è `EXECUTION_READY` |

Le funzioni distruttive richiedono in seguito `EXECUTION_APPROVED`, backup
fisico verificato, checksum/firma e frase esatta `APPLY WORKSPACE_FOUNDATION_V1`
o `ROLLBACK WORKSPACE_FOUNDATION_V1`. Nessun wrapper contiene token.

## E. Test nel runtime Apps Script

Da eseguire solo dopo il Checkpoint 1 e su codice caricato nell'ambiente di
test, senza selezionare funzioni distruttive:

1. selezionare `workspaceMigrationShowFingerprint`; eseguire; confrontare hash,
   stato e conteggi con A/B;
2. selezionare `workspaceMigrationRunSafeRuntimeTests`; eseguire; richiedere
   `success: true`, rollback e protezione seconda esecuzione verificati;
3. selezionare `workspaceMigrationRunPreflight`; eseguire; richiedere
   `PREFLIGHT_PASSED` e zero errori;
4. selezionare `workspaceMigrationBuildPlan`; richiedere `EXECUTION_READY`,
   fingerprint atteso, 19 operazioni e checksum non vuoti;
5. selezionare `workspaceMigrationRunDryRun`; richiedere `success: true`, tutte
   le 19 operazioni valide, 3/2/3/11 nel report e `FAILED = 0`;
6. eseguire in ambiente fixture `testWorkspaceMigrationHardening`; richiedere
   seconda esecuzione rifiutata, collisioni rifiutate, postflight e rollback
   verificati;
7. come prova negativa, selezionare `workspaceMigrationExecute` senza parametri:
   deve terminare con “manifesto Workspace in stato EXECUTION_READY” prima di
   qualsiasi scrittura;
8. conservare solo fingerprint, checksum, esiti e messaggi; non copiare payload
   di righe o Settings.

Stop immediato per fingerprint diverso, autorizzazioni OAuth inattese, qualsiasi
scrittura osservata, test fallito o risultato contenente dati sensibili.

## F. Prova completa su copia fisica

Questa procedura richiede il Checkpoint 2 approvato e non va eseguita ora.

1. Dal browser, usare “File → Crea una copia” sul Google Sheet; attribuire un
   nome inequivocabile `TEST-WORKSPACE-MIGRATION-<data>`.
2. Verificare manualmente che copia e origine abbiano stessi fogli, header,
   conteggi, Project ID, Task ID e Timeline; non modificare l'origine.
3. Creare/collegare una copia separata del progetto Apps Script alla copia del
   foglio. Confermare dall'editor che `getActiveSpreadsheet().getId()` sia
   quello della copia, senza comunicare pubblicamente l'ID.
4. Eseguire fingerprint, preflight, piano e dry run secondo E.
5. Registrare baseline: 8 colonne Projects, 11 progetti, numero task, numero
   Timeline, numero Settings, assenza Workspaces/Aliases e checksum baseline.
6. Solo con autorizzazione dedicata alla prova, usare un artefatto di test
   `EXECUTION_APPROVED`, backup fisico verificato e conferma forte riferiti
   esclusivamente alla copia.
7. Eseguire la migrazione sulla copia.
8. Postflight atteso: 9 colonne Projects; 11 `WorkspaceID` valorizzati; 2 righe
   Workspaces; 3 righe WorkspaceAliases; un solo default (`WS0001`); 9 progetti
   in WS0001 e 2 in WS0002; conteggi e contenuti Tasks/Timeline/Settings invariati.
9. Preparare il piano inverso con `workspaceMigrationPrepareRollback`, annotare
   checksum e numero operazioni; autorizzare esplicitamente il rollback prova.
10. Eseguire `workspaceMigrationRollback` con piano, backup e conferma coerenti.
11. Verifica finale: Projects torna agli otto header originari; Workspaces e
    WorkspaceAliases sono assenti; gli 11 progetti e tutti i valori delle prime
    otto colonne coincidono con la baseline; Task, Timeline e Settings
    coincidono per conteggio e checksum; MigrationLog conserva l'audit del
    ciclo e quindi è l'unica differenza prevista rispetto a una copia byte-per-byte.

Stop e ripristino dalla copia di sicurezza se una precondizione diverge o il
rollback strutturale viene rifiutato. Non tentare correzioni manuali intermedie.

## G. Anomalie preesistenti

| Anomalia | Classificazione |
|---|---|
| `Scanner` / `Scanner di rete` | Non modificata; non blocca se sono Project ID distinti, entrambi nel mapping e senza riferimenti orfani |
| `Progetto gite (trasferte)` / `Ottimizzazione motore trasferte` | Non modificata; non blocca alle stesse condizioni |
| Task aperte in `Scanner di rete` completato | Anomalia semantica separata; non viene corretta e non blocca lo schema Workspace |
| Task ID realmente duplicati | Bloccante: il preflight restituisce `TASK_ID_DUPLICATE` |
| Task/Timeline con Project ID inesistente | Bloccante: riferimento orfano |
| Progetti semanticamente simili | Non vengono uniti o rinominati; intervento separato se desiderato |

Le anomalie non bloccanti restano identiche prima, dopo e dopo rollback. Task ID
duplicati e riferimenti orfani devono essere risolti con una migrazione o
correzione separata, approvata e verificata prima di Workspace Foundation.

## H. Runbook di esecuzione assistita

1. Eseguire la checklist C, un passaggio alla volta.
2. **CHECKPOINT 1 — Approvazione esplicita del preflight manuale.**
3. Eseguire la procedura runtime E e consegnare fingerprint/checksum/esiti.
4. **CHECKPOINT 2 — Approvazione esplicita del test nel runtime Apps Script.**
5. Preparare ed eseguire la prova completa su copia secondo F.
6. **CHECKPOINT 3 — Approvazione esplicita della prova su copia fisica.**
7. Presentare destinazione, metodo e criteri di verifica del backup reale.
8. **CHECKPOINT 4 — Autorizzazione esplicita al backup reale.**
9. Creare e verificare backup raw, copia Sheet ed export offline; ricontrollare
   che il database non sia cambiato rispetto al dry run.
10. Presentare fingerprint congelato, checksum manifesto/baseline, backup
    verificato, piano di 19 operazioni e piano di rollback.
11. **CHECKPOINT 5 — Autorizzazione esplicita a impostare il manifesto come
    `EXECUTION_APPROVED`.**
12. Preparare l'artefatto approvato senza cambiare payload o fingerprint; una
    variazione diversa dal solo stato richiede di ripartire dal Checkpoint 1.
13. Presentare la frase forte, la finestra operativa e i criteri di stop.
14. **CHECKPOINT 6 — Autorizzazione esplicita alla migrazione reale.**
15. Eseguire sotto lock, verificare postflight e fermarsi; rollback se il
    postflight non passa.
16. Presentare esito, report, verifiche read-only e piano di rilascio coordinato.
17. **CHECKPOINT 7 — Autorizzazione esplicita al deployment coordinato.**
18. Solo dopo il Checkpoint 7 seguire il runbook di rilascio vigente.

Silenzio, approvazioni precedenti, successo tecnico o prosecuzione della
conversazione non approvano alcun checkpoint successivo.

## I. Stato finale del pacchetto

`EXECUTION_READY`, non `EXECUTION_APPROVED`.
