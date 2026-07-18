# LEGACY_WORKSPACE_NORMALIZATION_V1

## Scopo

Trasforma esclusivamente la baseline Legacy Workspace Nominale nella baseline
legacy accettata da `WORKSPACE_FOUNDATION_V1`, senza introdurre `WorkspaceID`,
`Workspaces`, `WorkspaceAliases` o altri elementi della nuova architettura.

## Baseline accettata

`Projects` deve avere esattamente gli header `ID`, `Progetto`, `Stato`, `Focus`,
`Responsabile`, `Prossima azione`, `Creato il`, `Ultimo aggiornamento`, `""`.
Gli undici Project ID e i valori nominali della nona colonna devono coincidere
con il mapping congelato nel codice. `Workspaces` e `WorkspaceAliases` devono
essere assenti. Formule, valori inattesi, righe o colonne dati aggiuntive
interrompono il preflight.

## Stato finale

`Projects` deve risultare logicamente composto dalle sole otto colonne legacy;
A:H, righe e Project ID restano invariati. Gli altri fogli restano invariati e
il preflight non deve più produrre `PROJECTS_SCHEMA_INCOMPATIBLE`.

## Sicurezza

Preflight, fingerprint, manifest checksum e backup fisico verificato sono
obbligatori. L'esecuzione richiede `EXECUTION_APPROVED` e la frase
`APPLY LEGACY_WORKSPACE_NORMALIZATION_V1`. Il rollback richiede la frase
`ROLLBACK LEGACY_WORKSPACE_NORMALIZATION_V1` e viene rifiutato se Workspace
Foundation è presente o se lo stato normalizzato è divergente.

## Sequenza

1. Preflight read-only.
2. Manifest congelato e backup fisico verificato.
3. Esecuzione esclusiva della normalizzazione.
4. Postflight.
5. Nuovo preflight Workspace Foundation.

La migrazione non corregge Task ID duplicati e non avvia Workspace Foundation.
