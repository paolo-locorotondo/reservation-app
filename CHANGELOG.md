# CHANGELOG

Storico delle feature/refactor completati. Le voci più recenti in alto. Le voci aperte stanno in [TODO.md](./TODO.md).

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
