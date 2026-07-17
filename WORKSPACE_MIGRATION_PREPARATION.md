# Preparazione operativa migrazione Workspace

## Stato

Documento di preparazione. Non autorizza backup, scritture, migrazioni o
deployment. Il controllo manuale deve essere completato prima di congelare la
baseline e costruire il manifesto eseguibile.

## A. Checklist manuale del Google Sheet

### Regole generali

1. Aprire dal browser il Google Sheet usato dalla Web App Desk in produzione.
2. Non modificare celle, filtri, ordinamenti, formati, fogli o intervalli.
3. Annotare titolo del file, URL visualizzato e data/ora del controllo, senza
   condividere token o credenziali.
4. Elencare tutti i tab visibili e nascosti nell'ordine in cui compaiono.
5. Per ogni foglio annotare `getLastRow` equivalente manuale: ultima riga che
   contiene un valore, inclusa l'intestazione.
6. Segnalare celle unite, formule, righe/colonne nascoste, filtri attivi e
   protezioni nelle aree controllate.
7. Non correggere alcuna anomalia durante il preflight.

Stop immediato se il file non è quello usato da Desk in produzione, se non è
possibile identificare con certezza il foglio corretto o se qualcuno modifica
il database durante il controllo.

### Projects

Aprire `Projects`.

Intestazioni baseline attese nelle colonne A-H:

| Colonna | Intestazione |
|---|---|
| A | `ID` |
| B | `Progetto` |
| C | `Stato` |
| D | `Focus` |
| E | `Responsabile` |
| F | `Prossima azione` |
| G | `Creato il` |
| H | `Ultimo aggiornamento` |

Controllare anche I1:

- stato iniziale più probabile: colonna I assente o I1 vuota;
- se I1 è `workspace`, `WorkspaceID` o qualsiasi altro valore, riportare
  intestazione e tutti i valori non vuoti della colonna I;
- se esistono colonne dopo I, riportarne intestazioni e uso.

Verificare tutte le righe dati e riportare per ciascuna A, B, C, H e I. La
baseline proposta contiene esattamente questi 11 Project ID:

```text
PRJ-20260716142952
PRJ-20260716141419
PRJ-20260716121441
PRJ-20260710095800
PRJ-20260716103301
PRJ-20260716091407
PRJ-20260716080119
PRJ-20260709095234
PRJ-20260708130248
PRJ-20260710130212
PRJ-20260714130206
```

Controllare:

- 11 righe progetto, oltre all'intestazione;
- nessun ID vuoto o duplicato;
- nessun Project ID aggiuntivo o mancante;
- nomi, stati e date coerenti con il report precedente;
- assenza di formule nelle colonne A-I;
- assenza di valori Workspace non documentati.

Stop immediato per intestazioni diverse, ID mancanti/aggiuntivi/duplicati,
formule in A-I, colonna Workspace già popolata in modo non compatibile o righe
nascoste che contengono progetti.

### Tasks

Gli snapshot prodotti da `MigrationDataSource` conservano sia i campi nominati
sia `rawValues` posizionali. Di conseguenza le colonne finali con header vuoto
non collassano in una singola proprietà durante checksum e confronto. La
Workspace Foundation usa questo formato corretto e non usa `rowHash()` né la
ricostruzione legacy di TASK_ID_REPAIR_V1.

Aprire `Tasks`.

Intestazioni attese, nell'ordine A-K:

```text
ID
ProjectID
Title
Description
Status
Priority
Assignee
DueDate
CreatedAt
UpdatedAt
CompletedAt
```

Riportare:

- numero totale di righe dati;
- elenco di tutti gli ID duplicati;
- elenco dei `ProjectID` distinti;
- task con `ProjectID` vuoto o non presente nei 11 Project ID attesi;
- conferma specifica per `TSK-20260714131725` e
  `TSK-20260716121446`, già apparsi duplicati nella lettura API;
- task aperte associate al progetto completato `PRJ-20260714130206`.

Stop immediato per intestazioni diverse, ProjectID orfani, ID vuoti, formule
nelle colonne chiave o modifiche concorrenti. Gli ID duplicati non vanno
corretti manualmente, ma devono bloccare il manifesto finché non sono valutati.

### Timeline

Aprire `Timeline`.

Intestazioni attese, nell'ordine A-D:

```text
Data
Project ID
Tipo
Descrizione
```

Riportare:

- numero totale di righe dati;
- elenco dei `Project ID` distinti;
- righe con Project ID vuoto o non presente nei 11 ID attesi;
- righe con Data, Tipo o Descrizione vuoti;
- eventuali formule o righe nascoste.

Stop immediato per intestazioni diverse, riferimenti orfani o modifiche
concorrenti. La migrazione Workspace non deve modificare questo foglio.

### Settings

Aprire `Settings`.

Se il foglio contiene intestazioni, quelle previste sono:

```text
Key
Value
```

Riportare tutte le righe non vuote, in particolare chiavi contenenti
`workspace`, `defaultWorkspace`, URL, versioni o configurazioni di migrazione.
Non riportare valori che siano token o credenziali: indicare soltanto
`[VALORE SENSIBILE PRESENTE]`.

Stop immediato se esiste già una configurazione Workspace non documentata o se
la verifica richiederebbe mostrare un segreto.

### Workspaces

Cercare un tab con nome esatto `Workspaces`, anche tra i fogli nascosti.

Stato iniziale più probabile: foglio assente.

Se presente, le sole intestazioni compatibili, nell'ordine A-F, sono:

```text
ID
Name
IsDefault
Status
CreatedAt
UpdatedAt
```

Riportare tutte le righe. Stop immediato se il foglio esiste, anche vuoto,
finché la baseline non viene aggiornata; stop anche per header diversi, ID non
conformi a `WS` più almeno quattro cifre, più default attivi o dati inattesi.

### WorkspaceAliases

Cercare un tab con nome esatto `WorkspaceAliases`, anche tra i fogli nascosti.

Stato iniziale più probabile: foglio assente.

Se presente, le sole intestazioni compatibili, nell'ordine A-C, sono:

```text
Alias
WorkspaceID
CreatedAt
```

Riportare tutte le righe. Stop immediato se il foglio esiste finché la baseline
non viene aggiornata, oppure per alias duplicati, riferimenti sconosciuti o
intestazioni diverse.

### MigrationLog

Cercare `MigrationLog`, incluso tra i fogli nascosti.

Se presente, intestazioni attese:

```text
MigrationID
Sequence
OperationID
Action
Sheet
Status
Before
After
Message
RecordedAt
EntryChecksum
```

Riportare soltanto MigrationID, numero di righe e stati. Non copiare payload
che possano contenere informazioni sensibili. Stop immediato se esiste già un
log relativo alla futura migrazione Workspace o se il log risulta manomesso.

### Altri fogli

Riportare nome, visibilità, intestazioni e numero righe di ogni altro foglio.
Stop immediato se un foglio usa i nomi riservati della migrazione con maiuscole
o spazi differenti, perché potrebbe generare collisioni operative.

## B. Mapping definitivo proposto

### Workspaces

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

### Projects

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

Il mapping è chiuso: nessuna assegnazione può essere aggiunta o dedotta dal
nome. La baseline deve contenere esattamente gli 11 ID sopra indicati.

## C. Verifica del codice di migrazione

Stato del framework dopo la milestone Workspace Migration Hardening:
**implementazione locale completa, non autorizzata all'esecuzione**.

| Requisito | Stato | Evidenza/gap |
|---|---|---|
| Aggiungere `Projects.WorkspaceID` | PRESENTE | operazione strutturale `ADD_COLUMN`, posizione 9 obbligatoria |
| Creare `Workspaces` | PRESENTE | `CREATE_SHEET` con header esatti |
| Creare `WorkspaceAliases` | PRESENTE | `CREATE_SHEET` con header esatti |
| Creare WS0001/WS0002 | PRESENTE | record immutabili nel manifesto |
| Un solo default WS0001 | PRESENTE | preflight e dati approvati verificano un solo default |
| Mapping solo esplicito | PRESENTE | mapping chiuso incorporato in `WorkspaceMigration` |
| Stop per Project ID mancante | PRESENTE | confronto esatto dell'insieme ID |
| Stop per Project ID inatteso | PRESENTE | confronto esatto dell'insieme ID |
| Stop per dati Workspace incompatibili | PRESENTE | schema aggiornato o parziale sempre rifiutato |
| Non modificare altri dati | PRESENTE | sole tre strutture, cinque record e undici `WorkspaceID` |
| Rifiuto seconda esecuzione | PRESENTE | schema legacy obbligatorio più MigrationID univoco |
| Report completo | PRESENTE | categorie, warning/errori, durata ed esito |
| Rollback verificabile | PRESENTE | inverse strutturali con controllo dello stato corrente |

Prima di autorizzare la migrazione restano obbligatori i passaggi operativi:

1. certificare manualmente la baseline reale;
2. eseguire i test Apps Script dedicati in un ambiente non produttivo;
3. produrre e verificare backup e dry run soltanto dopo autorizzazione;
4. congelare checksum e firma del manifesto;
5. cambiare la modalità da `EXECUTION_READY` a `EXECUTION_APPROVED` soltanto
   nell'artefatto espressamente autorizzato;
6. verificare il rollback sulla copia fisica prima della finestra operativa.

La suite `testWorkspaceMigrationHardening()` copre migrazione completa simulata,
schema aggiornato/incompatibile, ID mancanti/inattesi/duplicati, seconda
esecuzione, collisioni di workspace/default/alias, report e rollback completo.
Comprende inoltre il postflight sullo stato migrato; le eccezioni del writer
mantengono un report `FAILED` con durata, errore e operazioni già applicate.

## D. Piano di migrazione e rilascio

1. Ricevere il resoconto manuale completo della sezione A.
2. Confrontarlo con la baseline proposta; fermarsi per qualsiasi differenza.
3. Risolvere separatamente duplicati Task e progetti semanticamente duplicati,
   senza includere correzioni arbitrarie nella migrazione Workspace.
4. Completare e testare il supporto alle operazioni strutturali indicato in C.
5. Congelare manifesto, Project ID, Workspace, alias, header e conteggi attesi.
6. Lasciare il manifesto in modalità non eseguibile.
7. Isolare in una copia pulita le sole modifiche Workspace e le dipendenze del
   framework di migrazione realmente necessarie.
8. Per i file misti applicare selettivamente soltanto gli hunk approvati.
9. Verificare sintassi, `git diff --check`, OpenAPI, test Workspace e test del
   framework nella copia pulita.
10. Verificare che la copia pulita non contenga token e che `ApiConfig.js` non
    venga distribuito con placeholder o valore vuoto.
11. Richiedere autorizzazione esplicita separata per il backup raw.
12. Dopo autorizzazione, acquisire backup raw e backup fisico secondo runbook.
13. Calcolare checksum della baseline e verificare che il database non sia
    cambiato dal controllo manuale.
14. Eseguire preflight read-only e produrre tutti i gate PASS/FAIL.
15. Eseguire dry run e produrre operazioni, before/after, conteggi e piano
    inverso, senza scritture.
16. Consegnare checksum, firma, report, backup ID e frase di conferma richiesta.
17. Attendere autorizzazione esplicita alla migrazione; nessun silenzio o
    conferma generica vale come autorizzazione.
18. Preparare una finestra di manutenzione: dopo la migrazione il Web App
    precedente non comprende gli ID `WS0001/WS0002`.
19. Caricare la sorgente candidata con `clasp push` da copia pulita, senza
    aggiornare ancora il deployment Web App.
20. Iniettare nella copia di rilascio la configurazione token prevista dal
    Worker senza mostrarla o salvarla nel repository.
21. Creare una versione Apps Script candidata immutabile, senza associarla
    ancora alla Web App in produzione.
22. Ricontrollare baseline/checksum immediatamente prima della scrittura.
23. Eseguire la migrazione autorizzata sotto lock e registrare MigrationLog.
24. Verificare subito schema, due Workspace, tre alias, 11 assegnazioni, unico
    default, zero progetti senza Workspace e zero riferimenti nuovi orfani.
25. Se la verifica fallisce, non aggiornare il deployment e avviare il piano di
    rollback autorizzato dalla stessa baseline/backup.
26. Se la verifica passa, aggiornare dalla console il deployment Web App alla
    versione candidata; non usare `clasp deploy` o `clasp redeploy`.
27. Verificare URL `/exec` e GET `DESK API OK`.
28. Verificare tramite Worker `getProject` e `getWorkspaceBriefing` default.
29. Aggiornare il route handler Worker affinché inoltri `scope`, `workspaceId`
    e `workspace`, quindi pubblicare il Worker.
30. Verificare Worker con PRIMARY, FREELANCE, ALL, nome, alias e inesistente.
31. Aggiornare OpenAPI del Custom GPT e validarene il wrapper di risposta.
32. Aggiornare le istruzioni GPT.
33. Eseguire i test end-to-end della sezione F, prima read-only e poi mutativi
    soltanto con autorizzazione dedicata.
34. Conservare backup, checksum, log, versione Apps Script e deployment ID nel
    report di rilascio, senza token.

### Rollback

Il rollback deve essere autorizzato esplicitamente e verificare lo stato
corrente prima di ogni inversa. In ordine inverso deve:

1. ripristinare per gli 11 progetti il valore originario della nona colonna;
2. eliminare soltanto le tre righe alias create dalla migrazione;
3. eliminare soltanto WS0002 e WS0001 creati dalla migrazione;
4. rimuovere `WorkspaceAliases` e `Workspaces` solo se checksum, header e righe
   coincidono esattamente con quanto creato e non esistono dati successivi;
5. rimuovere la colonna I solo se è ancora `WorkspaceID` e contiene
   esclusivamente i valori scritti dalla migrazione;
6. verificare che Projects, Tasks e Timeline coincidano con la baseline raw;
7. mantenere il MigrationLog di rollback e ripristinare la versione Web App
   precedente dalla console.

## E. File da isolare

### Feature Workspace

```text
Api.js
Constants.js
ConversationEngine.js
DeskEngine.js
ProjectRepository.js
ProjectService.js
Settings.js
Setup.js
TestConversationEngine.js
TestWorkspaceFoundation.js
TestWorkspaceManagement.js
UI.js
WorkspaceSettings.js
WorkspaceAdmin.js
WorkspaceAliasRepository.js
WorkspaceDataQualityService.js
WorkspaceMigration.js
WorkspaceRepository.js
WorkspaceService.js
WORKSPACE_ARCHITECTURE.md
WORKSPACE_MIGRATION_PREPARATION.md
openapi/desk-action.openapi.yaml
```

`gpt/DESK_ASSISTANT_INSTRUCTIONS.md` appartiene alla feature soltanto per gli
hunk relativi ai comandi Workspace.

### File misti da estrarre selettivamente

```text
README.md
CHANGELOG.md
gpt/DESK_ASSISTANT_INSTRUCTIONS.md
```

- README: separare documentazione Workspace dagli hunk del deployment runbook.
- CHANGELOG: separare Workspace dagli hunk Milestone 2B.
- istruzioni GPT: separare comandi Workspace dalle convenzioni date/durate.

### Modifiche non Workspace da non includere automaticamente

```text
AGENTS.md
DryRunEngine.js
MIGRATION_V14_DATA_FOUNDATION.md
MigrationManifest.js
MigrationPreflightValidator.js
MigrationRecordCodec.js
MigrationSafetyGuard.js
MigrationUtils.js
TestMigrationExecution.js
V14MigrationManifest.js
audit/
```

Le modifiche future necessarie al framework per fogli/colonne dovranno essere
revisionate come dipendenza esplicita della migrazione Workspace, non trascinate
interamente dalla bonifica Data Foundation.

## F. Test finali end-to-end

I test mutativi richiedono autorizzazione separata. Annotare richiesta, payload
effettivo, HTTP status, risposta e verifica raw.

1. `Desk`: deve usare PRIMARY/WS0001 e mostrare solo i 9 progetti LOTAR.
2. `Desk freelance`: deve usare FREELANCE; con due soli workspace equivale a
   WS0002/CLIENTI e mostra solo i 2 progetti cliente.
3. `Desk clienti`: deve risolvere il nome CLIENTI a WS0002.
4. `Desk tutte`: deve mostrare 11 progetti, con Workspace ID/nome coerenti.
5. `Desk LOTAR`: deve risolvere nome/alias a WS0001 e mostrare 9 progetti.
6. Lookup alias `Freelance`: una richiesta WORKSPACE con valore `Freelance`
   deve risolversi a WS0002. Il comando fisso `Desk freelance` usa invece lo
   scope FREELANCE; entrambi devono produrre lo stesso insieme iniziale.
7. Lookup alias `Lotar` e `Clienti`: devono risolversi rispettivamente a WS0001
   e WS0002.
8. Workspace inesistente: deve restituire errore controllato e zero scritture.
9. Separazione: nessuno dei 9 Project ID LOTAR deve comparire in CLIENTI e
   nessuno dei 2 Project ID CLIENTI deve comparire in LOTAR.
10. Creazione progetto senza workspace esplicito: deve creare nel default
    WS0001, mantenendo task e Timeline coerenti.
11. Creazione progetto in CLIENTI: oggi non è esposta end-to-end da
    `updateDesk`; `ProjectService.create(name, "WS0002")` la supporta, ma API,
    OpenAPI e GPT richiedono una modifica successiva esplicitamente autorizzata.
12. `Desk La Sfinge`: con gli alias approvati deve restituire workspace non
    trovato. `La Sfinge` è un progetto, non un alias Workspace. Per farlo
    risolvere a CLIENTI serve approvare l'alias aggiuntivo oppure progettare una
    vista progetto; non va dedotto automaticamente.

Per i test di creazione usare nomi univoci concordati e prevedere in anticipo
la loro rimozione/chiusura; non eseguirli durante le sole verifiche read-only.

## G. Informazioni da restituire dopo il controllo manuale

Fornire esclusivamente:

1. titolo del Google Sheet e data/ora del controllo;
2. elenco completo dei fogli, indicando visibili/nascosti;
3. per ogni foglio, intestazioni esatte in ordine e numero righe dati;
4. tabella Projects con ID, Progetto, Stato, Ultimo aggiornamento e valore
   colonna I;
5. elenco Project ID mancanti, inattesi o duplicati, anche se vuoto;
6. stato di I1 e di eventuali colonne successive in Projects;
7. elenco Task ID duplicati e ProjectID orfani;
8. esito specifico dei due Task ID sospetti e delle task aperte nel progetto
   completato scanner;
9. elenco Timeline con Project ID orfano o campi obbligatori vuoti;
10. righe non sensibili di Settings; per segreti soltanto
    `[VALORE SENSIBILE PRESENTE]`;
11. presenza e contenuto completo non sensibile di Workspaces e
    WorkspaceAliases;
12. presenza di MigrationLog, relativi MigrationID e stati, senza payload;
13. formule, celle unite, righe/colonne nascoste, filtri o protezioni rilevati;
14. conferma che durante il controllo nessun dato è stato modificato;
15. decisione sul comportamento desiderato per `Desk La Sfinge`;
16. decisione se la creazione in CLIENTI debba essere esposta a GPT/API oppure
    restare esclusivamente amministrativa.

Non fornire token, secret, cookie, credenziali o contenuti sensibili non
necessari al preflight.
