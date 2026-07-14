# Desk v1.4 - Data Foundation Migration Framework

## Scopo

La Milestone 1 introduce il framework read-only necessario a preparare la
bonifica approvata del database Desk. Non applica alcuna operazione a Google
Sheets e non introduce ancora il modello Workspace.

Il framework separa in modo esplicito:

1. acquisizione della fotografia corrente;
2. validazione rispetto alla baseline auditata;
3. simulazione delle operazioni;
4. produzione del log;
5. costruzione del piano inverso.

## Garanzia read-only

`MigrationDataSource` espone soltanto `readSheet()`. Nessuno dei componenti
della Milestone 1 contiene chiamate come `setValue()`, `appendRow()`,
`deleteRow()`, `insertSheet()` o altre API di scrittura Spreadsheet.

`DryRunEngine` produce un risultato con `dryRun: true`. `RollbackEngine`
produce un piano con `readOnly: true` ed `executable: false`. L'esecuzione delle
operazioni e del rollback non fa parte di questa milestone.

## Componenti

### MigrationDataSource

Legge integralmente un foglio e restituisce header, numero di riga e valori
normalizzati. Le date vengono convertite in ISO 8601 per rendere confronti e
checksum deterministici.

### BackupEngine

Crea una fotografia in memoria dei fogli dichiarati nella baseline. Il backup
include:

- migration ID;
- timestamp;
- contenuto dei fogli;
- checksum SHA-256;
- flag read-only.

Il salvataggio esterno e la verifica di una copia fisica dello Spreadsheet
restano un gate operativo precedente alla futura bonifica.

### MigrationManifest

Valida struttura, campi obbligatori e unicità degli operation ID. Il manifesto
preparato riceve un checksum che ne identifica esattamente il contenuto.

`V14_DATA_FOUNDATION_MANIFEST` contiene:

- fonte della baseline;
- conteggi attesi;
- header obbligatori;
- insiemi degli ID di Projects e Tasks;
- assertion sui record critici;
- piano record-per-record approvato dall'audit.

Le operazioni sono ordinate preventivamente: creazione del progetto di
destinazione, spostamenti, completamenti e aggiornamenti, eliminazione dei
record dipendenti, eliminazione finale dei progetti di test.

Il manifesto dichiara `DRY_RUN_ONLY` e non e' un esecutore.

### BaselineValidator

Confronta il backup corrente con la baseline prima di simulare qualsiasi
operazione. Verifica:

- presenza dei fogli;
- numero di record;
- header;
- insieme degli ID;
- assertion sui dati critici.

Ogni divergenza rende il dry run non riuscito e impedisce la pianificazione.

### DryRunEngine

Verifica ogni selettore del manifesto contro il backup. Per le operazioni di
modifica o eliminazione deve esistere esattamente un record; per `CREATE` il
record non deve esistere.

Gli eventi Timeline con testo duplicato usano sia il numero di riga auditato
sia il contenuto atteso. Il numero di riga non viene mai usato da solo.

### MigrationLog

Produce un log in memoria ordinato e dotato di checksum. Nella Milestone 1 gli
stati possibili sono `PLANNED` e `REJECTED`. Il log non viene scritto nel foglio
Timeline ne' in un nuovo foglio.

La persistenza futura in `MigrationLog` richiedera' approvazione separata.

### RollbackEngine

Costruisce in ordine inverso le compensazioni delle sole operazioni marcate
`APPLIED`. Conserva stato precedente e stato corrente atteso, ma non esegue le
compensazioni.

## Flusso

```text
Google Sheets (sola lettura)
  -> MigrationDataSource
  -> BackupEngine
  -> BaselineValidator
  -> DryRunEngine
  -> MigrationLog in memoria
  -> RollbackEngine (solo piano)
```

## Esecuzione di revisione

In Apps Script eseguire manualmente:

```text
testMigrationFramework()
```

Il test usa esclusivamente fixture in memoria. Verifica backup, checksum,
baseline valida e divergente, dry run, assenza di scritture e piano di rollback.

Prima di eseguire il manifesto reale dovra' essere aggiunto, in una milestone
approvata, un entry point esplicito che richiami `BackupEngine.create()` con
`MigrationDataSource`. Questa milestone non lo espone intenzionalmente.

## Gate per la milestone successiva

- revisione del manifesto record-per-record;
- approvazione definitiva del project ID scanner e dei valori finali;
- backup fisico verificato;
- dry run reale con baseline valida;
- approvazione del formato persistente di MigrationLog;
- progettazione del writer con lock e conferma esplicita;
- test del rollback su una copia dello Spreadsheet.

## Roadmap Milestone 2

La Milestone 2 dovra' risolvere le tre osservazioni emerse dalla review senza
ridurre le garanzie read-only della Milestone 1.

### 1. Backup fisico verificato

- creare una copia completa dello Spreadsheet prima di qualsiasi scrittura;
- esportare e conservare una copia indipendente in formato XLSX;
- registrare identificativo, timestamp, conteggi e checksum del backup;
- rileggere il backup e verificarne struttura e contenuto;
- impedire l'avvio della bonifica se creazione o verifica falliscono.

### 2. Persistenza separata di MigrationLog

- introdurre un archivio tecnico dedicato, separato dalla Timeline operativa;
- registrare migration ID, sequenza, record, stato precedente, stato successivo,
  esito e timestamp;
- rendere append-only le voci gia' applicate;
- verificare il checksum del log prima di costruire un rollback;
- assicurare che una nuova esecuzione riconosca migrazioni gia' applicate.

### 3. Rollback protetto ed eseguibile

- collegare il piano inverso a un writer dedicato soltanto dopo approvazione;
- richiedere lock applicativo, backup verificato e conferma esplicita;
- confrontare lo stato corrente con `expectedCurrent` prima di ogni ripristino;
- interrompere il rollback alla prima divergenza senza ignorare conflitti;
- testare rollback selettivo e completo esclusivamente su una copia;
- produrre un audit finale dopo ogni rollback.

### Ordine di implementazione

1. Backup fisico e relativa verifica.
2. Persistenza append-only di MigrationLog.
3. Writer della bonifica con lock e precondizioni.
4. Rollback eseguibile con confronto dello stato corrente.
5. Dry run e test distruttivi esclusivamente sulla copia.
6. Review del report e autorizzazione separata per il database operativo.

### Criteri di ingresso alla bonifica

- backup fisico leggibile e verificato;
- baseline reale ancora valida;
- MigrationLog persistente disponibile;
- writer e rollback testati sulla copia;
- nessuna operazione ambigua nel dry run;
- approvazione esplicita del report finale.

## Milestone 2A - Motore reale protetto

La Milestone 2A implementa le capacita' mutative necessarie alla futura
bonifica, ma non autorizza ne' esegue il manifesto operativo v1.4. Il manifesto
reale conserva `mode: DRY_RUN_ONLY` e viene rifiutato da
`MigrationSafetyGuard`.

### Backup fisico

`BackupEngine.createPhysical()`:

- crea una copia Google Sheets nello stesso folder, o in un folder esplicito;
- rilegge integralmente la copia e confronta il checksum con lo snapshot;
- esporta una copia indipendente XLSX;
- verifica che l'export sia stato creato e non sia vuoto;
- restituisce un certificato firmato con ID, checksum e risultati delle
  verifiche.

La creazione del backup non modifica il database sorgente, ma crea file su
Google Drive. Non viene invocata automaticamente.

### Writer

`MigrationWriter` supporta `CREATE`, `UPDATE`, `MOVE`, `COMPLETE` e `DELETE`.
Ogni operazione:

- verifica che il selettore individui esattamente il record atteso;
- conserva lo stato completo precedente e successivo;
- rifiuta campi non presenti negli header;
- preserva i valori Date tramite `MigrationRecordCodec`;
- interrompe immediatamente l'esecuzione in caso di divergenza.

Le eliminazioni Timeline basate sulla riga auditata sono ordinate in senso
decrescente, cosi' una cancellazione non altera la posizione delle successive.

### MigrationLog persistente

`MigrationLogRepository` crea, solo durante un'esecuzione autorizzata, il foglio
tecnico `MigrationLog`. Il log e' separato dalla Timeline e contiene:

- migration e operation ID;
- sequenza continua;
- azione e foglio;
- stato `PLANNED`, `APPLIED`, `FAILED`, `COMPLETED` o `ROLLBACK_APPLIED`;
- stato precedente e successivo codificato;
- messaggio e timestamp;
- checksum per singola voce.

Il repository espone solo append e lettura: non aggiorna e non elimina voci.
Checksum, header o sequenze alterati rendono il log non valido.

### Executor e controlli di sicurezza

`MigrationExecutor` puo' avviare una migrazione soltanto quando sono vere tutte
le seguenti condizioni:

1. manifesto in `EXECUTION_APPROVED`;
2. dry run riuscito;
3. checksum di manifesto, snapshot e certificato coerenti;
4. backup fisico verificato e relativo allo stesso Spreadsheet;
5. conferma strutturata con frase `APPLY <migrationId>`;
6. lock documento acquisito;
7. nuova fotografia del database identica a quella del dry run;
8. nessun log preesistente per la stessa migrazione.

Se la persistenza della voce `APPLIED` fallisce dopo una scrittura, il writer
esegue immediatamente la compensazione della singola operazione.

### Rollback eseguibile

`RollbackEngine` costruisce il piano inverso dalle sole voci `APPLIED`, in
ordine inverso, e puo' eseguirlo esclusivamente quando:

- il piano e' marcato eseguibile e il checksum e' valido;
- il MigrationLog persistente coincide con il piano;
- il backup fisico e' verificato e appartiene allo stesso Spreadsheet;
- viene fornita la frase `ROLLBACK <migrationId>`;
- il lock documento e' acquisito;
- ogni record coincide ancora con `expectedCurrent`.

Il rollback si interrompe alla prima divergenza e registra ogni compensazione
come nuova voce append-only.

### Stato operativo dopo la Milestone 2A

- nessun entry point richiama automaticamente backup, executor o rollback;
- il manifesto v1.4 reale non e' eseguibile;
- nessun foglio `MigrationLog` viene creato durante deploy o setup;
- nessuna bonifica e nessuna migrazione Workspace viene effettuata;
- l'abilitazione del manifesto richiede una nuova review e approvazione.

### Test

`testMigrationExecutionFramework()` usa esclusivamente Spreadsheet, Drive,
lock ed export simulati. Copre:

- backup fisico e verifica checksum;
- writer reale sulla fixture;
- MigrationLog persistente append-only;
- migrazione completa;
- rollback completo;
- preservazione Date;
- rifiuto del manifesto reale;
- rifiuto di conferme incomplete;
- rilevamento della manomissione del log.
