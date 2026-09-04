# Istruzioni operative per Desk Assistant

## Rilasci e infrastruttura

Prima di eseguire qualsiasi operazione relativa a Apps Script, Web App,
Cloudflare Worker, Custom GPT o pubblicazione in produzione:

1. leggere integralmente `DEPLOYMENT_RUNBOOK.md`;
2. seguirne la sequenza e i controlli senza saltare passaggi;
3. non usare `clasp deploy` o `clasp redeploy` sul deployment Web App;
4. non pubblicare da un working tree con modifiche non correlate;
5. non inserire o mostrare token reali nel repository, nella documentazione o
   nei log;
6. non dichiarare concluso il rilascio finché le chiamate read-only
   `getProject` e `getWorkspaceBriefing` non hanno verificato l'intera pipeline
   `Worker → Apps Script → Desk`;
7. eseguire test mutativi soltanto dopo il completamento delle verifiche
   read-only e con l'autorizzazione dell'utente.

Se il runbook e lo stato reale dell'infrastruttura non coincidono, fermarsi,
segnalare la differenza e chiedere conferma prima di modificare deployment,
URL o credenziali.

## Memoria ProjectActivity

Quando viene citata un'attività o campagna nominata, usare lo snapshot
ProjectActivity come percorso ordinario di recupero prima di Project e Task;
non scansionare Timeline. Scrivere `updateProjectActivity` solo per decisioni,
contenuti o configurazioni esplicitamente approvati, mai per brainstorming,
ipotesi o proposte dell'assistente. Per attività esistenti leggere prima la
snapshot version corrente. In caso di conflitto rileggere e non sovrascrivere
alla cieca. `updateDesk` resta responsabile di progresso generale del Project,
focus, next action e Task. Le regole complete sono in
`gpt/DESK_ASSISTANT_INSTRUCTIONS.md` e `PROJECT_ACTIVITY_PHASE3B.md`.

## Gestione delle scadenze

Salvo diversa indicazione esplicita dell'utente, applicare sempre questa
convenzione alle date e alle durate assegnate alle task.

### Data singola

Quando l'utente indica una sola data, per esempio "questa task è per il 20
luglio", "ricordamelo il 20 luglio" o "da fare il 20 luglio", interpretarla
come data di scadenza.

Nei recap mostrare la task come:

- futura fino al giorno precedente;
- `🔔 Da fare oggi / Scade oggi` nel giorno della scadenza;
- `⚠️ Task scaduta` dal giorno successivo.

### Intervallo

Quando l'utente indica una data iniziale e una durata, per esempio "inizia il
20 luglio e ho 3 giorni" o "parte lunedì e dura 5 giorni", interpretare la
prima data come data di inizio. La durata include il giorno iniziale; quindi la
data finale prevista è `data iniziale + durata - 1 giorno`.

Per un intervallo di 3 giorni che inizia il 20 luglio, mostrare:

- 20 luglio: `Da fare oggi`;
- 21 luglio: `In corso`;
- 22 luglio: `Ultimo giorno previsto`;
- dal 23 luglio: `⚠️ Scaduta`.

### Recap giornalieri

Quando l'utente scrive `Desk` o chiede un recap dei progetti, evidenziare
sempre le task in questo ordine:

1. task scadute;
2. task in scadenza oggi;
3. task nell'ultimo giorno della finestra prevista;
4. altre task attive.

Continuare a mostrare le task scadute finché non vengono completate o
riprogrammate.

### Calcolo dinamico dello stato temporale

Quando una task contiene una data di scadenza oppure una finestra temporale
(data di inizio e durata), determinare automaticamente il suo stato rispetto
alla data corrente. Non chiedere mai all'utente di specificare se la task è
urgente, in scadenza o scaduta.

Calcolare sempre uno dei seguenti stati:

- `Futura`;
- `Da fare oggi / Scade oggi`;
- `In corso`, per le task con intervallo;
- `Ultimo giorno previsto`, per le task con intervallo;
- `Scaduta`.

Ricalcolare lo stato ogni volta che l'utente scrive `Desk`, chiede un recap dei
progetti o formula una richiesta equivalente. Il calcolo è puramente dinamico:
dipende esclusivamente dalla data corrente e dalle informazioni temporali
associate alla task e non deve modificare i dati memorizzati della task o del
progetto.

Continuare a evidenziare le task scadute finché non vengono completate,
eliminate o riprogrammate.
