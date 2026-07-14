# Conversation Engine di Desk

## Stato Del Documento

Specifica ufficiale di progettazione.

Questo documento descrive come l'assistente AI utilizza Desk durante una conversazione con Max. Non definisce codice applicativo e non modifica il modello dati esistente.

## Obiettivo

Il Conversation Engine e' il livello che interpreta cio' che Max dice in chat e decide come usare Desk come memoria operativa.

La conversazione resta naturale. Desk non deve diventare un form da compilare. L'assistente deve ascoltare, interpretare, aggiornare quando e' sicuro, proporre quando serve conferma e chiedere chiarimenti solo quando manca un'informazione indispensabile.

## 1. Flusso Completo

```text
Utente
  -> Conversazione
  -> Interpretazione
  -> Desk Engine
  -> Desk
  -> Risposta all'utente
```

### Utente

Max scrive in linguaggio naturale:

- aggiornamenti sul lavoro;
- decisioni;
- promemoria;
- richieste operative;
- domande sullo stato dei progetti.

### Conversazione

L'assistente mantiene il contesto immediato della chat:

- progetto di cui si sta parlando;
- task citate;
- eventi recenti;
- intenzioni esplicite o implicite;
- eventuali informazioni mancanti.

### Interpretazione

Il Conversation Engine classifica il messaggio:

- aggiornamento di avanzamento;
- completamento;
- scoperta o informazione nuova;
- risposta ricevuta da terzi;
- promemoria;
- richiesta di stato;
- creazione progetto;
- modifica o chiusura task;
- messaggio ambiguo o non operativo.

### Desk Engine

Il Conversation Engine non scrive direttamente su Desk.

Quando serve leggere o modificare memoria operativa, passa da Desk Engine:

- recupera briefing;
- prepara aggiornamenti;
- applica aggiornamenti sicuri;
- invia proposte all'Inbox aggiornamenti;
- completa task tramite i Service.

### Desk

Desk contiene la memoria operativa persistente:

- progetti;
- focus;
- prossime azioni;
- stato;
- task;
- Timeline;
- aggiornamenti preparati.

### Risposta All'Utente

L'assistente risponde in modo breve e operativo:

- conferma cosa ha capito;
- segnala eventuali aggiornamenti applicati;
- propone modifiche se serve conferma;
- fa una domanda solo se necessaria.

## 2. Tipologie Di Messaggi Dell'Utente

### "Ho iniziato..."

Esempio:

```text
Ho iniziato a sistemare la vista briefing del progetto.
```

Cosa deve capire l'assistente:

- Max sta avviando un'attivita';
- il progetto o la task puo' essere esplicita o dedotta dal contesto;
- potrebbe esserci un cambio di focus operativo.

Dati da aggiornare:

- Timeline con evento di avanzamento, se il progetto e' chiaro;
- focus del progetto, se il nuovo focus e' esplicito;
- eventuale task esistente, se viene identificata.

Quando NON aggiornare Desk:

- se non e' chiaro a quale progetto si riferisce;
- se il messaggio e' solo conversazionale;
- se l'attivita' e' troppo vaga per diventare memoria utile.

Quando chiedere chiarimenti:

- se manca il progetto e non e' deducibile dal contesto;
- se "ho iniziato" riguarda un lavoro non presente in Desk e non e' chiaro se creare una task.

### "Ho finito..."

Esempio:

```text
Ho finito la schermata di aggiornamento assistito.
```

Cosa deve capire l'assistente:

- Max comunica un completamento;
- potrebbe corrispondere a una task aperta;
- puo' generare un evento Timeline.

Dati da aggiornare:

- completare la task corrispondente, se identificata con alta certezza;
- Timeline con evento di completamento;
- prossima azione, se Max la indica o se e' evidente dal contesto.

Quando NON aggiornare Desk:

- se non esiste una task corrispondente chiara;
- se "finito" e' riferito a un sotto-passaggio non tracciato;
- se il completamento potrebbe chiudere un'attivita' sbagliata.

Quando chiedere chiarimenti:

- se ci sono piu' task simili;
- se il completamento implica chiusura progetto o cambio stato non esplicito.

### "Ho trovato..."

Esempio:

```text
Ho trovato che la Timeline non ha ancora una vista dedicata.
```

Cosa deve capire l'assistente:

- Max ha scoperto un'informazione utile;
- puo' essere un rischio, una nota, una decisione o una futura task.

Dati da aggiornare:

- Timeline con informazione scoperta;
- eventuale task se Max chiede o implica un'azione;
- focus o prossima azione solo se la scoperta cambia il lavoro corrente.

Quando NON aggiornare Desk:

- se l'informazione e' generica o non collegata a un progetto;
- se e' una nota temporanea senza valore operativo;
- se richiede verifica prima di diventare memoria.

Quando chiedere chiarimenti:

- se non e' chiaro se Max vuole registrare una nota o creare una task;
- se manca il progetto.

### "Mi hanno risposto..."

Esempio:

```text
Mi hanno risposto che possiamo procedere con la pubblicazione.
```

Cosa deve capire l'assistente:

- e' arrivato un input esterno;
- puo' sbloccare un progetto;
- puo' cambiare stato da `WAITING` a `IN_PROGRESS`.

Dati da aggiornare:

- Timeline con risposta ricevuta;
- stato progetto, se il cambio e' esplicito o sicuro;
- prossima azione, se emerge dalla risposta;
- eventuali task successive.

Quando NON aggiornare Desk:

- se non e' chiaro chi ha risposto o per quale progetto;
- se la risposta non produce conseguenze operative;
- se il cambio stato e' solo ipotetico.

Quando chiedere chiarimenti:

- se ci sono piu' progetti in attesa;
- se "possiamo procedere" non indica quale azione fare dopo.

### "Ricordamelo..."

Esempio:

```text
Ricordamelo domani mattina.
```

Cosa deve capire l'assistente:

- Max vuole creare un promemoria o una task futura;
- serve identificare oggetto, data e contesto.

Dati da aggiornare:

- task con scadenza, se il sistema supporta date operative;
- Timeline, se il promemoria e' rilevante per il progetto;
- Inbox aggiornamenti, se il promemoria non puo' ancora essere applicato.

Quando NON aggiornare Desk:

- se manca l'oggetto del promemoria;
- se "domani" o la data non sono interpretabili con certezza;
- se il promemoria e' personale e non legato a Desk.

Quando chiedere chiarimenti:

- se manca cosa ricordare;
- se manca il progetto e il contesto non lo rende evidente;
- se la data e' ambigua.

### "A che punto siamo?"

Esempio:

```text
A che punto siamo con Desk?
```

Cosa deve capire l'assistente:

- Max chiede un briefing;
- non sta chiedendo una modifica;
- serve leggere Desk e sintetizzare.

Dati da aggiornare:

- nessun aggiornamento diretto;
- eventualmente Timeline solo se la richiesta stessa ha valore operativo, di norma no.

Quando NON aggiornare Desk:

- sempre, salvo richiesta esplicita di registrare una decisione emersa dopo il briefing.

Quando chiedere chiarimenti:

- se non e' chiaro il progetto;
- se la domanda puo' riferirsi a piu' contesti attivi.

### "Crea un progetto..."

Esempio:

```text
Crea un progetto per il nuovo sistema di briefing.
```

Cosa deve capire l'assistente:

- Max vuole creare una nuova entita' progetto;
- servono almeno nome e intento generale.

Dati da aggiornare:

- nuovo progetto;
- Timeline con creazione progetto;
- eventuale focus iniziale;
- eventuale prossima azione, se indicata.

Quando NON aggiornare Desk:

- se il nome progetto non e' chiaro;
- se Max sta solo ragionando su una possibilita';
- se la richiesta e' formulata come ipotesi.

Quando chiedere chiarimenti:

- se manca il nome;
- se ci sono progetti simili e c'e' rischio di duplicato;
- se non e' chiaro se creare un progetto o una task in un progetto esistente.

### "Chiudi questa attivita'..."

Esempio:

```text
Chiudi questa attività, e' completata.
```

Cosa deve capire l'assistente:

- Max vuole completare una task;
- "questa" deve essere risolta dal contesto conversazionale o da Desk.

Dati da aggiornare:

- task completata;
- Timeline con completamento;
- progetto aggiornato solo se la chiusura cambia focus, prossima azione o stato.

Quando NON aggiornare Desk:

- se non e' possibile identificare la task;
- se ci sono piu' task candidate;
- se la chiusura potrebbe alterare una task non corretta.

Quando chiedere chiarimenti:

- se "questa" non ha riferimento chiaro;
- se il completamento implica anche chiudere progetto o cambiare stato.

## 3. Regola Fondamentale

L'assistente deve fare il minor numero possibile di domande.

Le domande sono consentite solo quando manca un'informazione indispensabile per evitare un errore operativo.

Se l'informazione mancante non e' indispensabile, l'assistente deve:

- procedere con l'interpretazione piu' probabile;
- limitare l'aggiornamento alla parte sicura;
- preparare una proposta invece di applicare direttamente;
- dichiarare brevemente cosa ha registrato e cosa ha lasciato fuori.

## 4. Aggiornamenti Automatici

### Possono Essere Applicati Automaticamente

Aggiornamenti a basso rischio e chiaramente riferiti a un progetto:

- aggiunta di evento Timeline descrittivo;
- completamento di una task identificata con alta certezza;
- creazione di una task richiesta esplicitamente con titolo chiaro;
- registrazione di una risposta ricevuta;
- aggiornamento della prossima azione quando Max la dichiara esplicitamente;
- lettura e generazione di briefing.

### Richiedono Conferma

Aggiornamenti con rischio di perdita semantica o impatto sullo stato operativo:

- chiusura di un progetto;
- cambio stato progetto verso `BLOCKED` o `COMPLETED`;
- creazione di piu' task da un messaggio ambiguo;
- sostituzione del focus del progetto;
- applicazione di una proposta generata da AI;
- modifiche dedotte, non dichiarate;
- operazioni su task quando esistono piu' candidate simili.

### Non Devono Essere Applicati

Non si aggiorna Desk quando:

- il messaggio e' solo conversazionale;
- manca il progetto e non e' deducibile;
- l'utente sta esplorando un'idea senza chiedere azioni;
- l'informazione e' incerta o da verificare;
- l'aggiornamento sarebbe una supposizione fragile.

## 5. Ruolo Di Desk

Desk non e' il luogo dove Max lavora.

Desk e' la memoria operativa dell'assistente.

Max lavora nella conversazione, negli strumenti, nei documenti e nei progetti reali. Desk conserva cio' che serve all'assistente per:

- ricordare stato e contesto;
- sapere cosa e' aperto;
- sapere cosa e' stato deciso;
- proporre prossime azioni;
- evitare di chiedere sempre le stesse cose;
- produrre briefing utili.

La qualita' di Desk si misura dalla capacita' dell'assistente di aiutare Max con meno attrito, non dalla quantita' di dati registrati.

## 6. Principi Progettuali

- La conversazione e' l'interfaccia primaria.
- Desk e' memoria, non burocrazia.
- L'assistente deve interpretare prima di chiedere.
- Ogni domanda deve avere una ragione operativa indispensabile.
- Gli aggiornamenti certi possono essere applicati direttamente.
- Gli aggiornamenti incerti diventano proposte.
- Le proposte importanti richiedono conferma di Max.
- Le scritture definitive passano sempre da Desk Engine.
- La Chat non scrive direttamente su Google Sheets.
- La Timeline resta append-only.
- Il sistema deve preferire piccoli aggiornamenti sicuri a grandi deduzioni fragili.
- L'assistente deve sempre distinguere tra fatto registrato, proposta e ipotesi.

## Criticita'

- Il riferimento implicito a "questo progetto" o "questa attivita'" richiede un contesto conversazionale affidabile.
- Applicare aggiornamenti automatici senza conferma puo' creare errori silenziosi se la classificazione e' sbagliata.
- Troppa prudenza trasformerebbe Desk in un sistema pieno di conferme; troppa autonomia rischierebbe modifiche non volute.
- Serve una strategia chiara per risolvere duplicati tra task simili.
- I promemoria richiedono una gestione robusta di date relative, fusi orari e contesto.
- Le proposte AI devono restare separate dagli aggiornamenti confermati.
