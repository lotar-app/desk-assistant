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
