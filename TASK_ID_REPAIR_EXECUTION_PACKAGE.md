# TASK_ID_REPAIR_V1 — Execution Package

## Identità

- Migration ID: `TASK_ID_REPAIR_V1`
- Version: `1.0.0`
- Stato: `VALIDATED/CLOSED`
- Tasks count: `40`
- Tasks checksum: `3d420bb30fc2c7e95021ba995172ac1d1af6a5a8d097d01ae00cd67bc3740d44`
- Fingerprint SHA-256: `e213f1745979fd258aaf6333df5c33ee2b4f87f942151976993107bb7186f4bc`

Il fingerprint è `MigrationUtils.checksum()` applicato al manifesto canonico
senza alcun dato runtime variabile. Due chiamate a `frozenManifest()` devono
restituire oggetti equivalenti e lo stesso fingerprint.

> Archivio storico: il fingerprint documenta il manifesto autorizzato ed
> eseguito. Questo pacchetto non è più eseguibile e non deve essere riutilizzato
> su questo workspace. Il codice rifiuta preflight, autorizzazione e writer V1.

## Manifesto congelato

```json
{
  "migrationId": "TASK_ID_REPAIR_V1",
  "version": "1.0.0",
  "mode": "EXECUTION_READY",
  "baseline": {
    "sheets": {
      "Tasks": {
        "recordCount": 40,
        "requiredHeaders": [
          "ID", "ProjectID", "Title", "Description", "Status", "Priority",
          "Assignee", "DueDate", "CreatedAt", "UpdatedAt", "CompletedAt"
        ]
      }
    }
  },
  "tasksChecksum": "3d420bb30fc2c7e95021ba995172ac1d1af6a5a8d097d01ae00cd67bc3740d44",
  "taskCount": 40,
  "expectedHeaders": [
    "ID", "ProjectID", "Title", "Description", "Status", "Priority",
    "Assignee", "DueDate", "CreatedAt", "UpdatedAt", "CompletedAt"
  ],
  "expectedExtraHeaders": ["", ""],
  "expectedDuplicateIds": [
    "TSK-20260714131725",
    "TSK-20260714131729",
    "TSK-20260716121446"
  ],
  "repairEntries": [
    {
      "rowNumber": 13,
      "oldTaskId": "TSK-20260714131725",
      "rowHash": "4252c9c2890b1907d81c0b1678a7acf4ea8e223d925adcbe338e8a88b65d1f85",
      "newTaskId": "TSK-20260714131725-R02"
    },
    {
      "rowNumber": 18,
      "oldTaskId": "TSK-20260714131729",
      "rowHash": "95dcd4428b302953aac773d71a963419000e5a79e1c8a1d434f14084dc222eaf",
      "newTaskId": "TSK-20260714131729-R02"
    },
    {
      "rowNumber": 38,
      "oldTaskId": "TSK-20260716121446",
      "rowHash": "65273d6f0920eb403cac17c011d7287fd31cb04115482a1510e8ac3349a6305b",
      "newTaskId": "TSK-20260716121446-R02"
    }
  ],
  "operations": [
    {
      "operationId": "TASK-ID-REPAIR-001",
      "action": "UPDATE",
      "sheet": "Tasks",
      "selector": { "_rowNumber": 13, "ID": "TSK-20260714131725" },
      "after": { "ID": "TSK-20260714131725-R02" },
      "expectedRowHash": "4252c9c2890b1907d81c0b1678a7acf4ea8e223d925adcbe338e8a88b65d1f85",
      "reason": "Riparazione esplicita Task ID duplicato; nessun altro campo autorizzato."
    },
    {
      "operationId": "TASK-ID-REPAIR-002",
      "action": "UPDATE",
      "sheet": "Tasks",
      "selector": { "_rowNumber": 18, "ID": "TSK-20260714131729" },
      "after": { "ID": "TSK-20260714131729-R02" },
      "expectedRowHash": "95dcd4428b302953aac773d71a963419000e5a79e1c8a1d434f14084dc222eaf",
      "reason": "Riparazione esplicita Task ID duplicato; nessun altro campo autorizzato."
    },
    {
      "operationId": "TASK-ID-REPAIR-003",
      "action": "UPDATE",
      "sheet": "Tasks",
      "selector": { "_rowNumber": 38, "ID": "TSK-20260716121446" },
      "after": { "ID": "TSK-20260716121446-R02" },
      "expectedRowHash": "65273d6f0920eb403cac17c011d7287fd31cb04115482a1510e8ac3349a6305b",
      "reason": "Riparazione esplicita Task ID duplicato; nessun altro campo autorizzato."
    }
  ],
  "fingerprint": "e213f1745979fd258aaf6333df5c33ee2b4f87f942151976993107bb7186f4bc"
}
```

## Vincolo del writer

L'esecuzione deve iniettare esclusivamente
`TaskIdRepairMigration.createWriter(spreadsheet)`. Il writer generico non è
autorizzato per questa migrazione. Il writer dedicato:

1. richiede `EXECUTION_APPROVED`;
2. riconosce soltanto le tre operazioni congelate;
3. verifica numero riga, vecchio ID e hash completo;
4. richiede che `after` contenga esclusivamente `ID`;
5. usa `setValue()` solamente sulla colonna `CONFIG.TASK_COLUMNS.ID`.

## Preflight checklist

Checklist storica, conservata esclusivamente per audit. Non deve essere
eseguita nuovamente su questo workspace.

- [x] Autorizzazione esplicita separata ricevuta per l'esecuzione storica.
- [ ] Backup fisico verificato disponibile e riferito allo stesso Spreadsheet.
- [ ] Lock documentale acquisibile.
- [ ] Fingerprint manifesto uguale a quello di questo documento.
- [ ] Schema: primi 11 header esatti e due soli header vuoti finali.
- [ ] Task count esattamente 40.
- [ ] Checksum Tasks esattamente
      `3d420bb30fc2c7e95021ba995172ac1d1af6a5a8d097d01ae00cd67bc3740d44`.
- [ ] Esattamente tre gruppi duplicati, ciascuno con due occorrenze.
- [ ] Nessun altro Task ID duplicato.
- [ ] Righe 13, 18 e 38 ancora seconde occorrenze fisiche.
- [ ] Vecchi ID e rowHash coincidenti col manifesto.
- [ ] I tre nuovi ID non esistono.
- [ ] Dry run: esattamente tre operazioni valide.
- [ ] Writer configurato: `TaskIdRepairMigration.createWriter()`, non writer
      generico.

## Postflight checklist

- [ ] Task count ancora 40.
- [ ] Zero Task ID duplicati.
- [ ] Righe 13, 18 e 38 contengono i nuovi ID congelati.
- [ ] Tutti gli altri Task ID sono invariati.
- [ ] Il checksum ricostruito sostituendo virtualmente i tre nuovi ID con i
      vecchi coincide con la baseline.
- [ ] ProjectID, Title, Description, Status, Priority, Assignee, DueDate,
      CreatedAt, UpdatedAt e CompletedAt sono invariati.
- [ ] Timeline e tutti gli altri fogli sono invariati.
- [ ] Report: tre operazioni applicate, zero warning/errori, durata e checksum.

## Rollback checklist

- [ ] Usare soltanto il piano prodotto da `rollbackPlan()` sul post-stato.
- [ ] Piano con tre operazioni nell'ordine righe 38, 18, 13.
- [ ] Checksum del piano verificato e conferma esplicita ricevuta.
- [ ] Per ogni riga verificare nuovo ID e `expectedCurrentHash`.
- [ ] Usare esclusivamente `applyRollbackOperation()` del writer dedicato.
- [ ] Ripristinare solamente la cella `Tasks.ID`.
- [ ] Dopo rollback: checksum Tasks uguale alla baseline e i tre gruppi
      duplicati originali nuovamente presenti.
- [ ] Fermarsi se anche una sola riga o hash è divergente; ripristinare dal
      backup fisico invece di forzare.

## Condizioni di interruzione

Interrompere prima di qualsiasi scrittura per differenza di fingerprint,
checksum, conteggio, schema, extra header, gruppi duplicati, numero riga, ID,
rowHash, presenza dei nuovi ID, lock, backup o writer. Interrompere durante
l'operazione al primo errore e non applicare manualmente le operazioni residue.

## Criteri di successo

Successo esclusivamente se sono state applicate tre modifiche alle celle ID
autorizzate, il postflight passa integralmente, non esistono duplicati residui e
il report non contiene errori. Qualsiasi altro esito è fallimento e richiede il
piano di rollback autorizzato.

## Chiusura e validazione

Stato finale: `VALIDATED/CLOSED`. La recovery read-only ha restituito
`RECOVERY_VALIDATED`, zero duplicati, sole differenze ID autorizzate, nessun
errore e checksum canonico ricostruito coincidente con la baseline. Il falso
fallimento originario dipendeva dal collasso dei due header vuoti e dal
conseguente hash ambiguo nel postflight/rollback, non da modifiche ai dati non
autorizzate. La correzione usa snapshot posizionali e confronto canonico A:K
con esclusione di `ID` soltanto sulle tre righe autorizzate.
