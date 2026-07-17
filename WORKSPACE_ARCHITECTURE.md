# Architettura Workspace

## Stato della decisione

Questo documento definisce il modello Workspace approvato per Desk. Il modello
sostituisce l'appartenenza basata sul nome con un riferimento stabile e prepara
le viste `Desk`, `Desk freelance`, `Desk tutte` e `Desk <workspace>`.

La migrazione dei dati e il deployment restano operazioni separate: il codice
può essere predisposto e testato senza applicare assegnazioni al foglio reale.

## Obiettivi

- rinominare un workspace senza aggiornare i progetti;
- risolvere nomi e alias verso un ID stabile prima di interrogare il motore;
- mantenere un solo workspace predefinito;
- supportare workspace attivi, disattivati e privi di progetti;
- spostare o unire workspace senza cambiare Project ID, task o Timeline;
- rendere visibili dati mancanti, incoerenti od orfani;
- conservare la compatibilità dei client che non inviano parametri.

## Modello dati

### Workspaces

| Campo | Significato |
|---|---|
| `ID` | ID immutabile nel formato `WS` + 4 cifre, indipendente dal nome |
| `Name` | nome visualizzato modificabile |
| `IsDefault` | booleano; un solo workspace attivo può essere predefinito |
| `Status` | `ACTIVE` o `DISABLED` |
| `CreatedAt` | data di creazione |
| `UpdatedAt` | data dell'ultima modifica |

Gli ID vengono assegnati cercando il massimo progressivo esistente e
incrementandolo. Un ID non viene mai riutilizzato, neppure dopo la
disattivazione o il merge.

### WorkspaceAliases

| Campo | Significato |
|---|---|
| `Alias` | nome alternativo, confrontato in forma normalizzata |
| `WorkspaceID` | riferimento a `Workspaces.ID` |
| `CreatedAt` | data di creazione dell'alias |

Gli alias sono record separati, non una lista serializzata dentro Workspaces.
Questo consente alias multipli, ricerca indicizzata e controllo di unicità
senza un'altra migrazione strutturale. Anche il nome principale partecipa alla
risoluzione e non può collidere con nomi o alias di altri workspace.

### Projects

La nona colonna diventa `WorkspaceID`. Contiene esclusivamente l'ID stabile del
workspace. Un valore mancante resta mancante: non viene convertito nel
workspace predefinito durante la lettura.

Il codice operativo richiede l'header `WorkspaceID`. La diagnostica di preflight
riconosce e segnala l'eventuale header legacy `workspace`, ma il deployment del
nuovo motore deve avvenire soltanto dopo la migrazione dello schema e dei dati.
La migrazione assegna gli ID tramite mapping esplicito per Project ID.

## Invarianti

- esiste al massimo un workspace `ACTIVE` con `IsDefault = true`;
- il workspace predefinito non può essere disattivato o assorbito da un merge;
- nomi e alias sono univoci con confronto case-insensitive e spazi normalizzati;
- un progetto può riferirsi soltanto a un workspace esistente;
- i nuovi progetti usano il workspace predefinito solo quando il chiamante non
  specifica un workspace;
- letture legacy o dati incompleti non applicano fallback impliciti;
- workspace disattivati restano leggibili per audit ma non accettano nuove
  assegnazioni;
- task e Timeline restano associate al Project ID e non vengono riscritte
  durante spostamenti, rinomine o merge.

## Risoluzione e livelli applicativi

L'interfaccia può ricevere un nome o un alias. `WorkspaceService.resolve()` lo
traduce in Workspace ID prima di invocare il briefing. `DeskEngine` opera su ID
o su scope già validati e non dipende dai nomi visualizzati.

Gli scope sono:

- `PRIMARY`: solo il Workspace ID predefinito;
- `FREELANCE`: tutti i workspace attivi diversi dal predefinito;
- `ALL`: tutti i workspace attivi;
- `WORKSPACE`: un singolo Workspace ID risolto da nome, alias o ID.

L'assenza di scope mantiene il comportamento storico e significa `PRIMARY`.

## Operazioni amministrative

### Assegnazione e spostamento

Assegnare o spostare un progetto aggiorna soltanto `Projects.WorkspaceID` e
`Projects.UpdatedAt`. Project ID, task e Timeline non cambiano. Il workspace di
destinazione deve esistere ed essere attivo; non viene creato implicitamente.

### Rinomina

La rinomina aggiorna solo `Workspaces.Name` e `UpdatedAt`. Il vecchio nome può
essere conservato come alias quando richiesto. Nessun progetto viene riscritto.

### Merge

Il merge sposta in un'unica operazione tutti i progetti dal workspace sorgente
al workspace destinazione e disattiva il sorgente. La cancellazione non è
prevista: la disattivazione conserva identità, audit e possibilità di diagnosi.
Il nome e gli alias del sorgente vengono trasferiti alla destinazione quando
non collidono, così le richieste storiche continuano a risolversi.
Il record sorgente disattivato riceve un nome tecnico `Merged <ID> - <nome>`:
questo libera il nome precedente, che può diventare alias della destinazione
senza creare collisioni tra record attivi e disattivati.

Il merge richiede sorgente e destinazione distinti e attivi. Il workspace
predefinito non può essere il sorgente. Un lock impedisce aggiornamenti
concorrenti durante lo spostamento.

## Migrazione

La migrazione contiene un mapping immutabile `Project ID -> Workspace ID`. Non
deduce mai l'appartenenza dal nome, da alias, da valori precedenti o da campi
mancanti. L'insieme dei Project ID osservati deve coincidere esattamente con
quello approvato: un ID mancante, inatteso o duplicato interrompe il preflight.

La sola baseline accettata è lo schema legacy con otto colonne `Projects`,
senza `Workspaces` e senza `WorkspaceAliases`. Uno schema già aggiornato o
parzialmente aggiornato viene rifiutato: non esiste una modalità automatica di
completamento o riconciliazione.

Le operazioni strutturali sono `ADD_COLUMN` e `CREATE_SHEET`. Il relativo
rollback elimina la colonna soltanto se tutti i valori sono già stati
ripristinati a vuoto ed elimina i fogli soltanto quando contengono esclusivamente
gli header attesi. Qualsiasi divergenza blocca il rollback e richiede il
ripristino dal backup fisico verificato.

La protezione contro la riesecuzione è duplice: precondizioni strutturali legacy
e assenza di record `WORKSPACE_FOUNDATION_V1` nel `MigrationLog`. Il manifesto
rimane `EXECUTION_READY`; non è autorizzato all'esecuzione finché non viene
prodotta e approvata una variante firmata `EXECUTION_APPROVED` secondo il
framework di sicurezza.

Prima dell'esecuzione sono obbligatori backup, dry run, validazione del mapping
approvato e verifica dei conteggi secondo il runbook. La migrazione non viene
eseguita automaticamente durante setup o deployment.

Il report distingue operazioni strutturali, workspace creati, alias creati,
progetti aggiornati, warning, errori, durata ed esito finale. Anche un'eccezione
di esecuzione espone `migrationReport`, con le operazioni già applicate utili a
costruire il rollback. Il postflight rilegge lo stato finale e richiede schema,
conteggi, mapping, unico default e riferimenti alias esattamente coerenti.

## Data quality

La diagnostica amministrativa espone almeno:

- progetti senza Workspace ID;
- progetti che riferiscono workspace inesistenti;
- workspace senza progetti;
- workspace predefiniti mancanti o multipli;
- collisioni tra nomi e alias;
- alias verso workspace inesistenti;
- task e Timeline con Project ID inesistente.

## API e compatibilità

`getWorkspaceBriefing` accetta facoltativamente `scope`, `workspaceId` e
`workspace`. I client esistenti possono continuare a inviare soltanto
`action: getWorkspaceBriefing`: il server applica `PRIMARY`.

Per `WORKSPACE`, l'API privilegia `workspaceId`; `workspace` viene risolto da
nome o alias prima di chiamare il motore. Le risposte includono gli ID e i nomi
dei workspace selezionati.

## Trade-off

- due fogli (`Workspaces` e `WorkspaceAliases`) aumentano il numero di
  repository e controlli, ma eliminano dipendenze dai nomi e future migrazioni
  per alias multipli;
- gli ID progressivi sono leggibili ma richiedono lock in creazione; il lock e
  la non riutilizzabilità evitano collisioni;
- la disattivazione conserva più dati della cancellazione, ma richiede filtri
  espliciti nelle viste operative;
- richiedere `WorkspaceID` nel codice operativo evita fallback ambigui, ma
  impone la sequenza migrazione schema/dati prima del deployment applicativo;
- `ALL` e `FREELANCE` aggregano più workspace in un unico briefing: ogni
  contesto deve quindi includere Workspace ID e nome per evitare ambiguità.
