# Desk Roadmap

Versione documento: 1.0  
Stato: In sviluppo

## Visione

Desk e' il centro operativo personale di Max.

Il progetto non mira a diventare un project manager generalista. Deve servire a riprendere velocemente un lavoro, riducendo il tempo tra apertura del progetto e comprensione dello stato operativo.

Obiettivo guida:

```text
Ogni progetto deve ripartire in meno di 30 secondi.
```

## Principi progettuali

1. La Sidebar e' l'interfaccia principale.
2. Aggiornare deve richiedere pochi click.
3. Progetti, task e Timeline devono essere collegati.
4. Ogni modifica di stato deve lasciare traccia.
5. Nessuna duplicazione dei dati.
6. La velocita' d'uso prevale sulla ricchezza funzionale.

## Stato attuale

### Projects

- [x] Creazione progetto da menu.
- [x] Elenco progetti nella Sidebar.
- [x] Lettura dettaglio progetto.
- [x] Aggiornamento Focus.
- [x] Aggiornamento Prossima azione.
- [x] Aggiornamento `updatedAt`.
- [x] Registrazione `PROJECT_CREATED`.
- [x] Registrazione `PROJECT_UPDATED` quando il campo aggiornamento contiene testo.

### Tasks

- [x] Creazione task da Sidebar.
- [x] Creazione task da menu tramite prompt.
- [x] Collegamento task a progetto tramite `ProjectID`.
- [x] Elenco task per progetto nella Sidebar.
- [x] Ordinamento UI: task aperte prima, completate dopo.
- [x] Completamento task da checkbox Sidebar.
- [x] Aggiornamento `CompletedAt`.
- [x] Aggiornamento `UpdatedAt`.
- [x] Registrazione `TASK_CREATED`.
- [x] Registrazione `TASK_COMPLETED`.

### Timeline

- [x] Append eventi su foglio `Timeline`.
- [x] Header automatico se il foglio e' vuoto.
- [x] Eventi implementati:
  - `PROJECT_CREATED`
  - `PROJECT_UPDATED`
  - `TASK_CREATED`
  - `TASK_COMPLETED`
- [ ] Vista Timeline dedicata.
- [ ] Filtri Timeline.
- [ ] Ricerca Timeline.

### Sidebar

- [x] Select progetto.
- [x] Ultimo aggiornamento progetto.
- [x] Focus.
- [x] Prossima azione.
- [x] Aggiornamento.
- [x] Elenco task.
- [x] Nuova task.
- [x] Salvataggio progetto.
- [x] Completamento task.
- [x] Stato inline senza `alert()`.
- [x] Indicatore `Caricamento...`.
- [ ] Ricerca.

### Dashboard

- [ ] Task aperte.
- [ ] Task completate oggi.
- [ ] Progetti attivi.
- [ ] Ultime attivita'.

## Roadmap Versione 1.0

Obiettivo: usare Desk ogni giorno come centro operativo personale.

- [x] Architettura Service/Repository.
- [x] Integrazione clasp.
- [x] Setup fogli base.
- [x] Gestione progetti essenziale.
- [x] Sidebar operativa.
- [x] Gestione task essenziale.
- [x] Completamento task.
- [x] Timeline eventi principali.
- [ ] Ricerca nella Sidebar.
- [ ] Dashboard V1.
- [ ] Vista Timeline consultabile.
- [ ] Archiviazione progetto.
- [ ] Ricerca progetti.
- [ ] Priorita' task modificabile da UI.
- [ ] Scadenza task modificabile da UI.
- [ ] Assegnatario task modificabile da UI.
- [ ] Filtri task.

## Roadmap Versione 2.0

- Dashboard evoluta.
- Statistiche.
- Tempo dedicato ai progetti.
- Grafici.
- Attivita' recenti aggregate.

## Roadmap futura

- Task ricorrenti.
- Duplicazione progetto.
- Duplicazione task.
- Preferiti.
- Task in ritardo.
- Indicatori colore.
- Suggerimento prossima attivita' tramite AI.
- Riepilogo automatico progetto.
- Ricerca semantica.
- Priorita' suggerite.
- Generazione automatica task.

## Funzionalita' escluse volutamente

- Kanban board.
- CRM.
- Gestione team avanzata.
- Commenti collaborativi.
- Allegati.
- Automazioni complesse.
- Dipendenze esterne.
- Multi-assegnazione task.

Queste funzioni sono escluse finche' non aiutano direttamente l'obiettivo dei 30 secondi.

## Decisioni architetturali

- Google Sheets e' il database.
- Apps Script e' il runtime applicativo.
- La Sidebar e' il centro operativo.
- I menu esistono come accesso o fallback, non come destinazione finale dell'esperienza.
- I Repository sono l'unico livello applicativo che deve leggere e scrivere i fogli.
- I Service contengono regole di dominio, validazioni e scrittura Timeline.
- `UI.js` espone funzioni server serializzabili per `google.script.run`.
- Le date native vengono convertite in stringhe prima di tornare alla Sidebar.

## Regole di progettazione

- Ogni modifica di stato deve aggiornare la Timeline.
- Ogni nuova funzione deve ridurre attrito operativo.
- Evitare finestre modali e prompt nei flussi principali.
- La Sidebar deve restare leggibile e veloce.
- Non duplicare dati tra fogli.
- Non modificare il modello dati senza una richiesta esplicita.
- Non introdurre nuove dipendenze.

## Criteri di qualita'

- Sintassi verificata prima del push.
- Test manuale su Google Sheets dopo `clasp push`.
- Nessun accesso diretto ai fogli dalla UI.
- Errori utente gestiti con messaggi chiari.
- Timeline aggiornata per cambiamenti di stato.
- UI senza popup invasivi nei flussi Sidebar.
