# CHANGELOG

Storico delle feature/refactor completati. Le voci più recenti in alto. Le voci aperte stanno in [TODO.md](./TODO.md).

## 2026-05-25 — Refresh manuale + auto-refresh dopo conflitto 409

Aggiornamento dati tabella scelto come combinazione (b) + (c) — niente polling per ora (MVP).

- **(b) Refresh manuale**: IconButton `Renew` (Carbon ghost, size sm, `disabled={loading}`) in:
  - [`SpotsBrowser.tsx`](apps/web/src/components/SpotsBrowser.tsx): nella toolbar accanto alla legenda interattiva (`.rsv-table-toolbar` flex space-between).
  - [`MyReservationsList.tsx`](apps/web/src/components/MyReservationsList.tsx): dentro ogni tab (PARKING e DESK), in una toolbar `flex justify-end` sopra la `DataTable`, così la posizione rispecchia quella di `SpotsBrowser`. Entrambi i bottoni invocano lo stesso `setReloadTick` del padre, quindi cliccarne uno ricarica i dati di entrambi i tab.
- **(c) Refresh on conflict 409**: [`BookingDialog.tsx`](apps/web/src/components/BookingDialog.tsx) espone una prop `onConflict?: () => void` chiamata nel catch quando `e instanceof ApiError && e.status === 409`. `SpotsBrowser` la collega a `setReloadTick((t)=>t+1)`: il dialog rimane aperto col messaggio italiano user-friendly mentre la tabella sotto si aggiorna silenziosamente, così alla chiusura l'utente vede già lo stato reale.
- **Cancel non rilevante per (c)**: in `MyReservationsList` la cancellazione tocca solo le prenotazioni dell'utente loggato (no race), quindi 409 non si applica — basta (b).
- [`globals.scss`](apps/web/src/styles/globals.scss): nuove classi `.rsv-table-toolbar` (con override nested `.rsv-legend { margin-bottom: 0 }` per evitare doppio spacing) e `.rsv-page-header`.
- **Polling (a) escluso per MVP**: traffico inutile, andrebbe sospeso su `visibilityState === "hidden"`, e l'inflight FE + 409-on-conflict coprono già il 99% dei casi pratici.

## 2026-05-25 — Tasto "Reset filtri" su entrambe le pagine

Bottone ghost size sm dentro `FiltersPanel`, visibile solo quando almeno un filtro è diverso dal default. Cancella Stato (`statusFilter`), filtri colonna (`colFilters`/`openFilter`) e:

- in [`SpotsBrowser.tsx`](apps/web/src/components/SpotsBrowser.tsx) **ripristina ai default**: `siteId` = prima sede, `floorId` = "Tutti i piani", `date` = oggi. La condizione `filtersActive` confronta col default vero (non con stringa vuota) per non mostrare il bottone allo stato iniziale.
- in [`MyReservationsList.tsx`](apps/web/src/components/MyReservationsList.tsx) **azzera** Sede/Piano/Data (lì il default è "vuoto") + colFilters. Sostituisce il precedente "Rimuovi filtri" che non toccava i filtri colonna.

## 2026-05-25 — Pannello filtri collassabile + legenda interattiva con filtro stato

Due miglioramenti UX sulle pagine di prenotazione, particolarmente sentiti su mobile dove la tabella restava sotto il fold.

- **Pannello filtri collassabile** ([`FiltersPanel.tsx`](apps/web/src/components/FiltersPanel.tsx), nuovo): wrapper riutilizzabile con bottone-toggle full-width, badge col numero di filtri attivi e riga di summary testuale ("Sede: Bari · Piano: 2 · Data: 2026-05-26") visibile quando collassato. Default espanso su desktop, collassato su mobile (`matchMedia("(max-width: 671px)")` valutato in `useEffect` per evitare hydration mismatch SSR).
  - Applicato a [`SpotsBrowser.tsx`](apps/web/src/components/SpotsBrowser.tsx) e a entrambi i tab in [`MyReservationsList.tsx`](apps/web/src/components/MyReservationsList.tsx) (PARKING e DESK con stato indipendente).
  - In `SpotsBrowser` il conteggio esclude `siteId` (sempre valorizzato) e `date` (default a oggi); in `MyReservationsList` conta tutti i filtri perché partono vuoti.
- **Legenda interattiva con conteggi e filtro per stato** ([`SpotsBrowser.tsx`](apps/web/src/components/SpotsBrowser.tsx)): la legenda prima decorativa diventa un controllo a chip cliccabili.
  - Mostra `Disponibile (N)` / `Occupato (M)` con conteggi calcolati su `colOnlyRows` (rows filtrate solo per colonna, non per stato), così cliccare una chip non azzera il conteggio dell'altra.
  - Click ciclico: AVAILABLE → OCCUPIED → null (mirror del pattern `nextSort`). `aria-pressed` per accessibilità; chip 1 verde, chip 2 rossa quando attive (border + box-shadow inset coerenti con gli swatch).
  - Pipeline filtri: status applicato prima dei colFilters, così i conteggi restano coerenti con la lista visibile.
- [`globals.scss`](apps/web/src/styles/globals.scss): aggiunte classi `.rsv-filters-panel/-toggle/-toggle-label/-summary/-chevron/-body` e `.rsv-legend-chip` (con `[aria-pressed="true"]` + `:nth-of-type` per il colore).

## 2026-05-25 — Nome utente in header con menu account (HeaderPanel)

Sostituito il vecchio span email + bottone Logout con un menu account espandibile basato sul pattern Carbon `HeaderPanel` + `Switcher`.

- [`AppShell.tsx`](apps/web/src/components/AppShell.tsx): `HeaderGlobalAction` con icona `UserAvatar` che toggla un `HeaderPanel`. Dentro un `Switcher` con header informativo (nome + email read-only) e voce "Esci" che chiama `signOut`.
- Click-outside e tasto `Escape` gestiti via `useEffect` con listener su `document` e ref su trigger/pannello (Carbon non li gestisce nativamente).
- Nome utente visibile anche fuori dal pannello come `<span className="rsv-header-username">` accanto all'avatar; nascosto su mobile (`@media max-width: 671px`) per non rubare spazio al titolo.
- [`globals.scss`](apps/web/src/styles/globals.scss): rimosso `.rsv-header-email`, aggiunti `.rsv-header-username` (ellipsis, max-width 200px), `.rsv-user-panel-info/-name/-email` per il blocco header del pannello.
- **Estendibilità**: il pattern Switcher è pronto per ospitare future voci ("impostazioni", "i miei riferimenti", ecc.) come `SwitcherItem` aggiuntivi sopra il divider.

## 2026-05-25 — Concorrenza prenotazioni: verifica (no fix)

Audit del codice in `apps/api/src/reservations/reservations.service.ts` senza modifiche al codice. Findings documentati in [TODO.md](./TODO.md) sotto "Concorrenza prenotazioni — verifica e hardening" per quando si deciderà di intervenire.

- ✅ **Race spot/giorno fra utenti**: protetta dal partial unique index SQL `WHERE status='ACTIVE'` su `(spotId, date)`. P2002 → `ConflictException`. Race-safe.
- ✅ **FE inflight già coperto**: `BookingDialog.tsx` disabilita il bottone Prenota e blocca `onRequestClose` durante `submitting`.
- ⚠️ **Race utente/giorno/tipo (doppio submit ravvicinato)**: teoricamente aperta — `findFirst` + `create` non transazionale. Probabilità bassa (FE già blocca), fix non implementato. Approccio raccomandato per il futuro: denormalizzare `spotType` su `Reservation` + partial unique `WHERE status='ACTIVE'` su `(userId, date, spotType)`, coerente col pattern già usato.
