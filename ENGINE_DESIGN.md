# Desk Engine Design

## 1. Scopo del Desk Engine

Desk Engine e' il livello centrale di coordinamento tra Desk, Max e l'assistente AI.

Non deve essere una semplice estensione della sidebar, ma la memoria operativa condivisa del sistema: raccoglie lo stato dei progetti, interpreta richieste e aggiornamenti, prepara briefing e coordina l'applicazione delle modifiche tramite i Service esistenti.

Desk Engine deve diventare il punto unico attraverso cui Chat, Sidebar e futuri moduli AI leggono e propongono operazioni sul Desk.

## 2. Responsabilita'

Desk Engine deve:

- comporre informazioni provenienti da progetti, task e timeline;
- produrre briefing strutturati per Sidebar e assistente;
- preparare aggiornamenti a partire da conversazioni o input manuali;
- mantenere separata la fase di proposta dalla fase di conferma;
- applicare aggiornamenti confermati usando i Service;
- fornire API stabili per UI, Chat e automazioni;
- preservare le regole di dominio gia' presenti nei Service;
- mantenere la Timeline come sorgente storica append-only.

## 3. Cosa NON Deve Fare

Desk Engine non deve:

- leggere o scrivere direttamente su Google Sheets;
- sostituire Repository o Service;
- contenere logica HTML, DOM o dettagli di UI;
- decidere layout o comportamento visivo della Sidebar;
- chiamare direttamente API AI senza passare da servizi dedicati;
- applicare aggiornamenti proposti senza conferma esplicita di Max;
- cancellare o riscrivere eventi Timeline;
- duplicare validazioni gia' appartenenti ai Service.

## 4. API Pubbliche Previste

API iniziali previste:

```js
DeskEngine.getProjectBriefing(projectId)
DeskEngine.getTodayOverview()
DeskEngine.prepareUpdateFromConversation(projectId, conversationSummary)
DeskEngine.applyPreparedUpdate(update)
DeskEngine.completeTask(taskId)
DeskEngine.getProjectMemory(projectId)
```

### `DeskEngine.getProjectBriefing(projectId)`

Restituisce un briefing completo del progetto:

- focus;
- prossima azione;
- stato;
- task aperte;
- eventi Timeline recenti;
- eventuale sintesi pronta per assistente.

### `DeskEngine.getTodayOverview()`

Restituisce una vista operativa della giornata:

- progetti attivi;
- task aperte rilevanti;
- progetti bloccati o in attesa;
- eventi recenti;
- possibili priorita' operative.

### `DeskEngine.prepareUpdateFromConversation(projectId, conversationSummary)`

Prepara una proposta di aggiornamento non ancora applicata.

Input:

- progetto;
- sintesi conversazione;
- eventuali segnali o intenzioni rilevate.

Output:

- focus proposto;
- prossima azione proposta;
- stato proposto;
- task proposte;
- evento Timeline proposto;
- metadati della proposta.

### `DeskEngine.applyPreparedUpdate(update)`

Applica un aggiornamento gia' preparato e confermato da Max.

Deve usare i Service esistenti per:

- aggiornare il progetto;
- creare task;
- completare task, se previsto;
- registrare eventi Timeline.

### `DeskEngine.completeTask(taskId)`

Wrapper applicativo per completare una task.

Deve delegare a `TaskService.complete(taskId)` e restituire lo stato aggiornato necessario a Sidebar e Chat.

### `DeskEngine.getProjectMemory(projectId)`

Restituisce la memoria operativa del progetto:

- dati correnti;
- task aperte e recenti;
- eventi Timeline;
- aggiornamenti preparati non applicati;
- contesto utile per l'assistente.

## 5. Flusso Dati: Chat Verso Google Sheets

```text
Chat / Assistente AI
  -> Desk Engine
  -> Service
  -> Repository
  -> Google Sheets
```

La Chat non deve mai scrivere direttamente sui fogli.

La Chat puo' chiedere a Desk Engine di preparare o applicare un'operazione. Desk Engine valida il flusso applicativo e delega ai Service. I Service applicano le regole di dominio e chiamano i Repository. I Repository sono l'unico livello che accede a Google Sheets.

## 6. Flusso Opposto: Google Sheets Verso Assistente

```text
Google Sheets
  -> Repository
  -> Service
  -> Desk Engine
  -> Briefing per assistente
```

Google Sheets resta la persistenza.

Repository legge i dati grezzi, Service li normalizza secondo il dominio, Desk Engine li compone in memoria operativa e briefing utilizzabili da Sidebar, Chat e futuri moduli AI.

## 7. Uso Dei Service

### ProjectService

Desk Engine usa `ProjectService` per:

- leggere un progetto;
- aggiornare focus, prossima azione e stato;
- normalizzare dati progetto;
- mantenere compatibilita' con progetti esistenti.

### TaskService

Desk Engine usa `TaskService` per:

- leggere task per progetto;
- filtrare task aperte;
- creare task proposte e confermate;
- completare task;
- ottenere dati aggiornati dopo operazioni.

### TimelineService

Desk Engine usa `TimelineService` per:

- leggere eventi recenti, tramite API dedicate;
- registrare eventi applicativi;
- mantenere la Timeline append-only.

### Futuri Servizi AI

Desk Engine non deve contenere direttamente chiamate AI.

Quando servira', usera' servizi dedicati, ad esempio:

```js
AiUpdateService.prepareProjectUpdate(context)
AiBriefingService.generateProjectSummary(context)
AiMemoryService.extractSignals(conversationSummary)
```

I servizi AI produrranno proposte. Desk Engine decidera' come inserirle nel flusso operativo, senza applicarle automaticamente.

## 8. Aggiornamenti Preparati Non Applicati

Un aggiornamento preparato e' una proposta strutturata ma non ancora confermata.

Deve includere:

- identificativo proposta;
- projectId;
- origine: Chat, Sidebar, automazione;
- testo sorgente o sintesi conversazione;
- modifiche proposte;
- task da creare;
- eventi Timeline proposti;
- stato: `DRAFT`, `PENDING_CONFIRMATION`, `APPLIED`, `DISCARDED`;
- data creazione;
- data ultima modifica;
- eventuali note di Max.

Fino alla conferma, un aggiornamento preparato non modifica Project, Task o Timeline.

## 9. Inbox Aggiornamenti

L'Inbox aggiornamenti e' la coda operativa delle proposte non ancora applicate.

Contiene:

- aggiornamenti proposti dall'assistente;
- aggiornamenti preparati dalla Sidebar;
- proposte generate da automazioni future;
- stato di conferma o scarto.

Flusso previsto:

```text
Assistente propone aggiornamento
  -> Desk Engine crea proposta
  -> Inbox aggiornamenti
  -> Max conferma, modifica o scarta
  -> Desk Engine applica solo se confermato
  -> Service
  -> Repository
  -> Google Sheets
```

L'Inbox evita che la Chat diventi un canale di scrittura diretta. Max resta il punto di conferma finale.

## 10. Regole Architetturali

- La UI non deve decidere la logica applicativa.
- La Sidebar deve chiamare API di livello alto, non Repository.
- La Chat non deve scrivere direttamente sui fogli.
- Google Sheets e' persistenza, non logica.
- I Repository sono l'unico livello autorizzato ad accedere ai fogli.
- I Service contengono regole di dominio e validazioni operative.
- Desk Engine coordina flussi e compone memoria, ma non sostituisce i Service.
- La Timeline e' append-only.
- Gli aggiornamenti preparati non devono avere effetti finche' Max non conferma.
- Le integrazioni AI devono produrre proposte, non mutazioni dirette.

## 11. Roadmap Di Implementazione

### Fase 1: Documento e Design

- Definire ruolo, confini e API previste del Desk Engine.
- Stabilire flussi tra Chat, Sidebar, Service, Repository e Google Sheets.
- Documentare Inbox aggiornamenti e aggiornamenti preparati.

### Fase 2: `DeskEngine.js` Wrapper

- Creare `DeskEngine.js`.
- Spostare composizioni gia' presenti in UI verso Desk Engine.
- Esporre API stabili per Sidebar.
- Mantenere compatibilita' con funzioni UI esistenti.

### Fase 3: Briefing

- Implementare `DeskEngine.getProjectBriefing(projectId)`.
- Implementare `DeskEngine.getTodayOverview()`.
- Implementare `DeskEngine.getProjectMemory(projectId)`.
- Uniformare formati dati restituiti a Sidebar e Chat.

### Fase 4: Update Preparati

- Definire modello degli aggiornamenti preparati.
- Creare Inbox aggiornamenti.
- Implementare creazione, modifica, conferma, applicazione e scarto.
- Garantire che le proposte non confermate non scrivano sui fogli operativi.

### Fase 5: Integrazione AI/Chat

- Collegare la Chat a Desk Engine.
- Introdurre servizi AI dedicati per preparare briefing e aggiornamenti.
- Mantenere conferma esplicita di Max prima di ogni scrittura.
- Rendere tracciabile origine e applicazione di ogni proposta.

## Criticita' Architetturali

- Serve evitare che Desk Engine diventi un duplicato dei Service: deve coordinare, non reimplementare regole di dominio.
- L'Inbox aggiornamenti richiedera' una scelta di persistenza: foglio dedicato, PropertiesService o altro storage.
- Le proposte AI dovranno essere versionate o almeno tracciate per evitare applicazioni obsolete.
- Il confine tra sintesi conversazione, memoria progetto e Timeline deve restare chiaro.
- La conferma di Max deve essere esplicita e verificabile, soprattutto quando la proposta crea task o cambia stato progetto.
