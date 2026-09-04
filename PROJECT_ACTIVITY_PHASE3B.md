# ProjectActivity — Fase 3B

## Scopo e limite

La Fase 3B definisce il comportamento del Desk Assistant per recuperare e
consolidare memoria ProjectActivity. Non modifica il modello dati, non attiva
D1, non aggiorna la configurazione reale del Custom GPT e non esegue chiamate
esterne. Le istruzioni entrano in funzione solo dopo una futura pubblicazione.

Il repository non contiene un harness capace di eseguire e valutare realmente
un modello LLM. I test 3B sono quindi test contrattuali statici: verificano che
le istruzioni contengano le regole obbligatorie e che 28 scenari strutturati
abbiano outcome completi e coerenti. Non misurano la comprensione linguistica o
l'affidabilità del modello in produzione.

## Retrieval policy

Per un riferimento nominato l'ordine è:

1. riferimento univoco nel contesto conversazionale corrente;
2. `getProjectActivity`, prima con il Project noto oppure tramite alias globale;
3. `getProject`;
4. `getProjectTasks`, solo se una Task è plausibile;
5. una chiarificazione mirata se il risultato resta assente o ambiguo.

Un match globale ProjectActivity unico viene usato automaticamente. Un
`AMBIGUOUS_ACTIVITY` richiede contesto capace di selezionare un solo candidato,
altrimenti una domanda. `ACTIVITY_NOT_FOUND` avvia il fallback Project/Task e
non giustifica una falsa dichiarazione di assenza. Timeline non è mai il read
path ordinario quando è disponibile uno snapshot.

## Consolidation policy

La snapshot contiene esclusivamente stato corrente valido e approvato. Segnali
inequivocabili come “approvato”, “teniamo questo”, “andiamo con”, “confermato”,
“versione definitiva” o una sostituzione esplicita autorizzano la scrittura.
Brainstorming, alternative, ipotesi, bozze, esempi, proposte dell'assistente e
reazioni non decisionali non la autorizzano.

“Approvato tutto” produce un singolo update multi-item soltanto se il contesto
identifica esattamente tutti gli elementi. Altrimenti richiede chiarimento.
Una sostituzione usa UPSERT sulla stable key esistente; una revoca esplicita
senza sostituzione usa DELETE con reason. Non si cancella una proposta mai
consolidata.

## Stable keys e tipi

Le chiavi descrivono ruoli stabili con gerarchie leggibili, per esempio
`email.first.subject`, `commercial.mechanism` e
`landing.form.hiddenFields`. Lo stesso ruolo mantiene la stessa chiave quando
cambia valore. Componenti con cicli di vita indipendenti non vengono compressi
in blob o array monolitici.

- `DECISION`: scelte e parametri approvati;
- `CONTENT`: copy e contenuti approvati;
- `TECHNICAL_CONTEXT`: provider e configurazioni tecniche correnti.

Più componenti approvati insieme vengono inviati come più operazioni item nella
stessa request, quindi producono una sola nuova snapshot version.

## Write decision tree

1. Risolvere Project e ProjectActivity senza ambiguità.
2. Stabilire se l'informazione è definitiva; altrimenti non scrivere.
3. Per attività esistente chiamare `getProjectActivity` e usare la versione
   restituita; per creazione esplicita usare versione `0`.
4. Costruire patch/item/alias minimi e una idempotency key per l'operazione.
5. Inviare un solo `updateProjectActivity` logico.
6. Usare anche `updateDesk` soltanto se cambia il progresso generale del
   Project, il suo focus, la next action o le Task.

`createIfMissing` è ammesso soltanto per una nuova attività persistente
esplicitamente iniziata, con Project e nome certi. Non viene usato per un nome
che potrebbe essere Project, Task, argomento o attività temporanea. Gli alias
si aggiungono solo quando diventano riferimenti stabili e non si rimuovono
automaticamente.

## Version conflict e idempotenza

La versione non viene inventata: per attività esistenti deriva sempre dalla
lettura immediatamente precedente. Su `SNAPSHOT_VERSION_CONFLICT` il GPT rilegge
la snapshot, rivaluta la decisione e può ritentare una sola volta se i valori
sono semanticamente compatibili. Una contraddizione richiede chiarimento e non
viene sovrascritta.

Su `IDEMPOTENCY_CONFLICT` non viene generata una nuova chiave per forzare la
scrittura. Il GPT rilegge lo stato e tratta l'errore come incoerenza.

La chiave preferita deriva da conversation ID, turn/message ID, activity e
operazione forniti dal runtime, senza contenuto sensibile. Poiché il runtime del
Custom GPT non garantisce tali identificatori nelle istruzioni, il fallback è
generare una chiave opaca prima della prima write, conservarla nel contesto del
turno e riusarla identica nei retry. Una decisione successiva usa una nuova
chiave. Un timestamp da solo non è sufficiente.

## `updateDesk` e `updateProjectActivity`

`updateDesk` conserva stato e avanzamento generale del Project, focus, next
action, Task e Timeline operativa. `updateProjectActivity` conserva decisioni,
copy, parametri e contesto tecnico correnti della campagna o attività interna.
Le due write sono entrambe necessarie solo quando una decisione interna cambia
anche il progresso generale; non si duplica indiscriminatamente la snapshot in
Project o Timeline.

## Esempi neutri

- “Potremmo usare fixture-only”: brainstorming, nessuna write.
- “Approviamo questo subject”: UPSERT `email.first.subject` come `CONTENT`.
- “Non più fixture-old, usiamo fixture-only”: UPSERT della stessa stable key.
- “Rimuoviamo il preheader senza sostituzione”: DELETE esplicito con reason.
- Subject, preheader e CTA approvati insieme: tre UPSERT in una sola request.

`Black Winter` e `Lotar` sono usati soltanto come fixture nominali. Nessun dato
commerciale reale è incluso.

## Prima dell'attivazione

Servono ancora configurazione D1 reale, migrazioni autorizzate, deploy separati
di Worker e Apps Script, aggiornamento manuale delle istruzioni del Custom GPT e
collaudo secondo `DEPLOYMENT_RUNBOOK.md`. Nulla di questo è eseguito in 3B.
