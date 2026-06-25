// Pagina di manutenzione servita dal middleware quando `MAINTENANCE_MODE=1`.
// HTML self-contained (CSS inline, nessun asset esterno) perché viene
// restituito direttamente dall'Edge middleware con status 503 — non passa per
// il rendering Next, quindi non può dipendere da /_next o da file statici.
// Testo in italiano, stile sobrio coerente col brand IBM.
export const MAINTENANCE_HTML = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Manutenzione in corso — Reservation App</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    background: #f4f4f4;
    color: #161616;
  }
  .card {
    max-width: 480px;
    width: 100%;
    background: #ffffff;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    padding: 2.5rem 2rem;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
  }
  .prefix { font-weight: 600; }
  h1 { font-size: 1.5rem; line-height: 1.3; margin: 0 0 0.75rem; }
  p { margin: 0 0 0.75rem; color: #525252; line-height: 1.5; }
  .bar { height: 4px; width: 48px; background: #0f62fe; border-radius: 2px; margin-bottom: 1.5rem; }
  .small { font-size: 0.8125rem; color: #6f6f6f; margin-top: 1.5rem; }
</style>
</head>
<body>
  <main class="card">
    <div class="bar"></div>
    <h1><span class="prefix">IBM</span> Reservation App</h1>
    <p><strong>Temporaneamente non disponibile.</strong></p>
    <p>
      L'applicazione è in manutenzione. Stiamo lavorando per riportarla
      online il prima possibile. Riprova tra qualche minuto.
    </p>
    <p class="small">Se il problema persiste, contatta l'amministratore.</p>
  </main>
</body>
</html>`;
