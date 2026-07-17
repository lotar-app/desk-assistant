# TASK_ID_REPAIR_V1

## Stato

`VALIDATED/CLOSED`. La riparazione è stata applicata e lo stato risultante è
stato certificato dalla recovery read-only (`RECOVERY_VALIDATED`): zero gruppi
duplicati, sole tre differenze ID autorizzate, nessun errore e checksum canonico
ricostruito uguale alla baseline. **TASK_ID_REPAIR_V1 non deve essere rieseguita
su questo workspace.** Preflight, autorizzazione e writer rifiutano ora una
nuova esecuzione.

## Incidente di postflight e rollback

L'esecuzione aveva scritto correttamente soltanto `Tasks.ID` alle righe 13, 18
e 38, ma il vecchio postflight aveva segnalato modifiche non autorizzate. La
causa era la rappresentazione delle due colonne finali prive di header: la
riduzione `header -> value` collassava entrambe nella stessa chiave vuota. Il
confronto ricostruiva poi la riga sostituendo virtualmente l'ID e calcolava un
hash che includeva quella rappresentazione ambigua. Lo stesso algoritmo era
usato dal piano di rollback e ne causava il blocco.

La correzione definitiva separa i due livelli:

- lo snapshot conserva anche `rawValues`, quindi tutte le colonne restano
  posizionali e nessun header duplicato viene perso;
- postflight e rollback confrontano una proiezione canonica degli 11 campi
  `TASK_HEADERS` contro lo snapshot pre-scrittura;
- per le tre righe autorizzate il confronto dei contenuti esclude solo `ID`;
- tutte le altre righe vengono confrontate integralmente sui campi A:K;
- una baseline esplicita è obbligatoria per postflight e rollback.

La recovery reale ha validato la correzione logica: `readOnly=true`,
`duplicateGroupCount=0`, `onlyAuthorizedIdsDiffer=true`, `errors=[]` e
`canonicalReconstructedChecksum == canonicalBaselineChecksum`.

## Generatore futuro

Formato base:

```text
TSK-yyyyMMddHHmmssSSS
```

Se il formato base esiste già, vengono provati in ordine:

```text
TSK-yyyyMMddHHmmssSSS-001
TSK-yyyyMMddHHmmssSSS-002
...
```

Un document lock copre insieme ricerca dell'ID e append della riga. Non vengono
usati valori casuali. Se il lock non viene acquisito entro 30 secondi, la task
non viene creata.

## Gruppi approvati

| Vecchio ID | Occorrenze | Regola |
|---|---:|---|
| `TSK-20260714131725` | 2 | prima riga conserva ID; seconda diventa `TSK-20260714131725-R02` |
| `TSK-20260714131729` | 2 | prima riga conserva ID; seconda diventa `TSK-20260714131729-R02` |
| `TSK-20260716121446` | 2 | prima riga conserva ID; seconda diventa `TSK-20260716121446-R02` |

Le task hanno stesso ProjectID ma titoli differenti: sono task distinte che
hanno subito una collisione del generatore, non copie da eliminare.

## Manifesto esplicito

Ogni `repairEntry` deve contenere:

- `rowNumber` della seconda occorrenza fisica;
- `oldTaskId`;
- `rowHash`, SHA-256 canonico dell'intera riga A:K;
- `newTaskId` conforme alla regola `-R02`.

`TaskIdRepairMigration.buildManifest()` rifiuta il congelamento se:

- i duplicati non sono esattamente i tre gruppi approvati;
- un gruppo non ha esattamente due righe;
- la riga indicata non è la seconda occorrenza fisica;
- l'hash non coincide;
- il nuovo ID esiste già, è duplicato o non rispetta `-R02`.

Il manifesto contiene inoltre checksum dell'intero foglio Tasks, fingerprint e
tre operazioni `UPDATE` con selettore `_rowNumber + ID`. Ogni `after` contiene
esclusivamente `ID`.

## Dati necessari per congelare il manifesto

Per ciascuna seconda occorrenza occorrono il numero riga e tutti gli 11 valori
della riga, oppure direttamente il `rowHash` prodotto da
`TaskIdRepairMigration.diagnose()`:

```text
rowNumber | oldTaskId | rowHash | newTaskId
```

Non è ammesso dedurre numero riga o hash dai soli Task ID.

## Preflight

1. schema Tasks esatto;
2. checksum completo invariato;
3. solo i tre gruppi duplicati approvati;
4. esattamente due occorrenze per gruppo;
5. numero riga e hash coincidenti;
6. seconda occorrenza selezionata;
7. nuovi ID assenti e univoci;
8. fingerprint manifesto valido.

Una differenza interrompe la riparazione.

## Postflight

Il postflight richiede lo snapshot Tasks pre-scrittura. Verifica i nuovi ID
nelle sole righe autorizzate e confronta con la baseline tutti gli altri campi
canonici A:K, escludendo `ID` solo su quelle tre righe. Le righe non autorizzate
devono coincidere integralmente. Richiede inoltre conteggio invariato e zero
Task ID duplicati.

## Rollback

Il piano richiede lo snapshot pre-scrittura, confronta i dieci campi canonici
diversi da `ID` con la baseline ed è generato in ordine inverso. Se baseline,
riga, ID corrente o contenuti divergono, il rollback viene rifiutato. L'unico
campo tecnicamente ripristinabile resta `Tasks.ID`; per V1, ormai chiusa, ogni
nuovo rollback o writer è comunque esplicitamente disabilitato.

## Report

Il report include gruppi iniziali, ID conservati, nuovi ID, righe aggiornate,
fingerprint, checksum baseline/finale, durata, esito preflight/postflight,
stato del rollback ed errori.

## Timeline e Workspace

Timeline non contiene Task ID e non viene modificata. Il pacchetto non importa,
chiama o modifica alcun componente della Workspace Migration.
