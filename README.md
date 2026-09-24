# Jarvis News

Dashboard personale per notizie recenti e ascolto vocale. Temi e preferenze vocali sono salvati nel browser.

## Avvio

```bash
pnpm install
pnpm dev
```

## Pubblicazione su Vercel

Importare il progetto come Next.js oppure eseguire `vercel deploy` dalla cartella del progetto. La route `/api/news` usa una funzione Node.js e non richiede chiavi API. Si devono verificare le richieste ai feed esterni dall'ambiente pubblicato prima di considerare operativo il sistema.

## Notizie

La route prova Google News RSS e, in caso di errore, Bing News RSS. Ogni risposta riporta le fonti non raggiungibili; se tutte falliscono restituisce HTTP 503 e l'interfaccia mostra un avviso. La lettura vocale usa le voci disponibili nel browser; su Android la voce dipende anche dalle impostazioni di sintesi del dispositivo.
