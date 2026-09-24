# Jarvis News

Dashboard personale per notizie recenti e ascolto vocale. Temi e preferenze vocali sono salvati nel browser.

## Avvio

```bash
npm install
npm run dev
```

## Pubblicazione su Vercel

Il progetto esistente su Vercel è collegato al ramo `main` di questo repository. Ogni push su `main` avvia un deploy di produzione. La route `/api/news` usa una funzione Node.js e non richiede chiavi API. Verificare le richieste ai feed esterni dall'ambiente pubblicato.

## Notizie e voce

La route prova Google News RSS e, in caso di errore, Bing News RSS. Se tutte le fonti falliscono restituisce HTTP 503 e l'interfaccia mostra un avviso. Jarvis evita di leggere una descrizione quando ripete il titolo. Durante il briefing il pulsante microfono interrompe la voce e ascolta il comando «approfondisci questa notizia». L'approfondimento estrae punti dal testo accessibile della fonte; se la testata impedisce la lettura automatica, mostra un messaggio e il link originale. Le voci e il riconoscimento vocale dipendono dal browser e dal dispositivo.
