# MemoryUpdate

## Scopo

`MemoryUpdate` e' il contratto dati tra Assistente e DeskEngine.

Rappresenta un aggiornamento preparato durante una conversazione, prima che venga applicato a Desk.

Non salva nulla, non conosce Google Sheets, non conosce Repository, Service o DeskEngine. Serve solo a descrivere in modo stabile cosa l'assistente propone di aggiornare.

## Struttura

```js
{
  projectId: "",
  summary: "",
  focus: null,
  nextAction: null,
  status: null,
  newTasks: [],
  completedTasks: [],
  timelineEvent: null,
  confidence: 1.0,
  needsConfirmation: false
}
```

## Campi

### `projectId`

Identifica il progetto a cui si riferisce l'aggiornamento.

Valorizzarlo quando:

- il progetto e' esplicito nella conversazione;
- il progetto e' deducibile con certezza dal contesto.

Lasciarlo vuoto solo nello stato iniziale creato da `MemoryUpdate.create()`.

Un update senza `projectId` non e' valido e non deve essere applicato.

### `summary`

Sintesi testuale dell'aggiornamento.

Valorizzarlo quando:

- Max descrive cosa ha fatto;
- Max comunica una decisione;
- l'assistente prepara una proposta leggibile;
- serve tracciare la ragione dell'update.

Lasciarlo vuoto quando:

- l'aggiornamento e' solo tecnico e verra' completato in seguito;
- non esiste ancora una sintesi affidabile.

### `focus`

Nuovo focus proposto per il progetto.

Valorizzarlo quando:

- Max indica chiaramente il nuovo centro operativo del progetto;
- la conversazione sposta esplicitamente il lavoro su un obiettivo diverso.

Lasciarlo `null` quando:

- il focus corrente non deve cambiare;
- il cambio focus e' solo dedotto;
- l'informazione non e' abbastanza sicura.

### `nextAction`

Prossima azione proposta.

Valorizzarlo quando:

- Max dice esplicitamente cosa fare dopo;
- dalla conversazione emerge una prossima azione diretta e non ambigua.

Lasciarlo `null` quando:

- non c'e' una prossima azione chiara;
- l'assistente dovrebbe inventarla;
- ci sono piu' opzioni possibili.

### `status`

Stato progetto proposto.

Valori previsti dal dominio progetto:

- `IN_PROGRESS`
- `WAITING`
- `BLOCKED`
- `COMPLETED`

Valorizzarlo quando:

- Max dichiara un cambio stato esplicito;
- una risposta esterna sblocca chiaramente il progetto;
- Max chiede di chiudere il progetto.

Lasciarlo `null` quando:

- lo stato non cambia;
- il cambio e' solo una deduzione;
- serve conferma di Max.

### `newTasks`

Elenco di task da creare.

Valorizzarlo quando:

- Max chiede esplicitamente di creare una task;
- la conversazione produce azioni concrete da tracciare;
- una proposta assistita contiene task future.

Lasciarlo come array vuoto quando:

- non ci sono nuove task;
- le azioni sono troppo vaghe;
- serve prima chiarire il progetto o il titolo.

Ogni elemento potra' evolvere verso una struttura piu' ricca. In v1 puo' essere una stringa o un oggetto semplice, secondo il chiamante.

### `completedTasks`

Elenco di task da completare.

Valorizzarlo quando:

- Max dice che una task e' finita;
- la task e' identificata con alta certezza;
- Max chiede esplicitamente di chiuderla.

Lasciarlo come array vuoto quando:

- non ci sono task completate;
- ci sono piu' candidate possibili;
- il riferimento e' ambiguo, ad esempio "questa attivita'" senza contesto sicuro.

### `timelineEvent`

Evento Timeline proposto.

Valorizzarlo quando:

- l'aggiornamento merita una traccia storica;
- Max comunica una decisione;
- arriva una risposta esterna;
- viene completata una fase rilevante.

Lasciarlo `null` quando:

- non serve registrare storia;
- il messaggio e' solo conversazionale;
- l'informazione non e' verificata.

### `confidence`

Livello di confidenza dell'assistente sull'update.

Deve essere un numero tra `0` e `1`.

Indicazioni:

- `1.0`: informazione esplicita e sicura;
- `0.7 - 0.9`: informazione molto probabile;
- `0.4 - 0.6`: interpretazione utile ma da confermare;
- `0.0 - 0.3`: informazione troppo incerta per applicazione diretta.

### `needsConfirmation`

Indica se Max deve confermare prima dell'applicazione.

Impostarlo a `true` quando:

- l'update cambia stato progetto;
- l'update chiude task o progetto con ambiguita';
- l'update deriva da una proposta AI;
- la confidenza non e' alta;
- l'azione potrebbe produrre effetti indesiderati.

Impostarlo a `false` quando:

- l'aggiornamento e' esplicito;
- il rischio e' basso;
- l'azione e' reversibile o solo descrittiva;
- si tratta di una Timeline informativa sicura.

## Validazione

`MemoryUpdate.validate(update)` verifica:

- `projectId` presente;
- `confidence` compresa tra `0` e `1`;
- `newTasks` array;
- `completedTasks` array.

La validazione non controlla l'esistenza reale del progetto o delle task. Quella responsabilita' appartiene a DeskEngine e ai Service.

## Uso Nel Conversation Engine

Il Conversation Engine usa `MemoryUpdate` per trasformare una conversazione in una proposta strutturata.

Flusso previsto:

```text
Conversazione
  -> interpretazione
  -> MemoryUpdate
  -> DeskEngine
  -> conferma o applicazione
```

Regole:

- se l'informazione e' sicura e a basso rischio, `needsConfirmation` puo' essere `false`;
- se l'informazione e' dedotta o ha impatto operativo, `needsConfirmation` deve essere `true`;
- se manca `projectId`, l'assistente deve chiedere chiarimento o mantenere la proposta non valida;
- se non c'e' cambio di un campo, lasciarlo `null` o vuoto;
- DeskEngine decide come applicare l'update, non MemoryUpdate.

## Evoluzioni Future

- Aggiungere `id` della proposta.
- Aggiungere `source`, ad esempio `CHAT`, `SIDEBAR`, `AUTOMATION`.
- Aggiungere `createdAt` e `updatedAt`.
- Definire una struttura formale per `newTasks`, `completedTasks` e `timelineEvent`.
- Aggiungere stati di workflow: `DRAFT`, `PENDING_CONFIRMATION`, `APPLIED`, `DISCARDED`.
- Collegare MemoryUpdate all'Inbox aggiornamenti.
