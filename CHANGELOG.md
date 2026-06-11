# CHANGELOG

Storico delle feature/refactor completati. Le voci più recenti in alto. Le voci aperte stanno in [TODO.md](./TODO.md).

## 2026-06-11 — Concorrenza prenotazioni: hardening DB-level (utente/giorno/tipo)

Fix definitivo della race "stesso utente, doppio submit ravvicinato dello stesso tipo" segnalata nel TODO. Senza questo, due richieste in volo potevano vedere entrambe `existing === null` nel check applicativo e creare due ACTIVE PARKING (o DESK) per lo stesso utente/giorno — bug silente, peggiore della classe.

**Approccio**: opzione 1 del TODO (denormalizzare `spotType` su `Reservation` + partial unique index SQL). Coerente col pattern già in uso per l'esclusività `(spotId, date)` ACTIVE.

- **Schema** [`schema.prisma`](apps/api/prisma/schema.prisma): nuovo campo `spotType: SpotType` su `Reservation`. Denormalizzazione di `Spot.type` (campo stabile — un posto non cambia tipo). Serve al partial unique index sotto, che altrimenti dovrebbe colpire una colonna join non esprimibile in Postgres.
- **Migration** [`20260611_add_spot_type_user_active_partial_unique`](apps/api/prisma/migrations/): generata con `--create-only` e SQL editato a mano (Prisma non supporta partial index nativamente):
  1. `ALTER TABLE ADD COLUMN "spotType" "SpotType"` (nullable, per non rompere righe esistenti)
  2. Backfill: `UPDATE Reservation SET spotType = (SELECT type FROM Spot ...)`
  3. `ALTER TABLE ALTER COLUMN ... SET NOT NULL`
  4. `CREATE UNIQUE INDEX "Reservation_userId_date_spotType_active_key" ON "Reservation"(userId,date,spotType) WHERE status='ACTIVE'`. Il `WHERE` preserva la possibilità di più CANCELLED storiche sulla stessa slot, come l'altro partial index.
  Applicata sia al Postgres locale sia a Supabase via `prisma migrate deploy`.
- **Service** [`reservations.service.ts`](apps/api/src/reservations/reservations.service.ts):
  - `create()` ora popola `spotType: spot.type` nella INSERT.
  - Il check soft `findFirst` usa `spotType` direttamente invece del join `spot: { type }` — più efficiente, no JOIN.
  - Il catch P2002 distingue best-effort i due index via `e.meta?.target`: se include `userId` → messaggio "hai già un posto auto/scrivania prenotata per questa data"; altrimenti "posto già prenotato per questa data". Coerente coi messaggi del check soft.
- **Race-safety**: la regola "max 1 ACTIVE per (utente, giorno, tipo)" è ora **DB-enforced**. Anche con doppio submit ravvicinato, il secondo INSERT solleva P2002 → `ConflictException` 409. Scartata l'opzione 2 (transazione `Serializable`): più codice, gestione di `40001 serialization_failure` con retry, meno robusto.
- **Test data** [`seed-1-spot-site.sql`](apps/api/prisma/test-data/seed-1-spot-site.sql): nessuna modifica necessaria (gli INSERT di Spot non hanno cambiato struttura). La sede di test resta valida per riprovare manualmente lo scenario "doppia prenotazione" — ora il backend rifiuta con 409 anche su race.

## 2026-06-09 — Rifiniture calendario: filtro zona, copy dinamica, scorciatoie

Cinque interventi piccoli a valle dei feedback d'uso.

- **Filtro zona nel calendario** ([`spots.service.ts`](apps/api/src/spots/spots.service.ts), [`SpotsAvailabilityQuerySchema`](packages/shared/src/spot.schema.ts), [`api.ts`](apps/web/src/lib/api.ts), [`SpotsCalendar.tsx`](apps/web/src/components/SpotsCalendar.tsx)): prima i pallini mostravano sempre il totale "tipo+sede+piano" ignorando la text search Zona della Lista (es. `Bari Piano 3` mostrava 62 anche con filtro `Stanza 314` che riduce a 8). Aggiunto `zoneName?: string` allo schema availability — text search ILIKE su `Zone.name` (replica il behavior client-side della Lista). [`SpotsBrowser.tsx`](apps/web/src/components/SpotsBrowser.tsx) lo passa al calendar via `colFilters.zone`.
- **Copy dinamica list/calendar**: il subtitle delle pagine `/parking`, `/desks` e `/my-reservations` si adatta alla vista. In Calendar: "clicca un giorno verde" / "clicca un giorno per prenotare o cancellare" + menzione del bordo blu per i giorni con propria prenotazione. La prop `subtitle` di [`SpotsBrowser`](apps/web/src/components/SpotsBrowser.tsx) è stata rimossa: ora il componente la calcola internamente da `type` + `view` (single source of truth, `/parking/page.tsx` e `/desks/page.tsx` non la passano più).
- **Scorciatoia "Prenota qui..." in /my-reservations vista Lista** ([`MyReservationsList.tsx`](apps/web/src/components/MyReservationsList.tsx)): nuovo `Button kind="ghost"` sotto il subtitle della pagina (livello principale, non per-tab). Label dinamico in base al tab attivo (`selectedIndex`): "Prenota qui i posti auto" (`/parking`) o "Prenota qui la tua scrivania" (`/desks`). Visibile solo in vista Lista quando ci sono prenotazioni — quando l'utente non ne ha ancora le Tabs non si montano (selectedIndex non significativo), quindi mostriamo entrambi i link inline accanto alla frase "Non hai prenotazioni attive." per offrirgli la scelta. In Calendario il click sui giorni copre già il flusso prenotazione.
- **Click su giorno-mio nel calendario di /my-reservations → modal cancel**: prima il click navigava sempre alla pagina di booking, anche sui giorni con propria prenotazione. Ora `handleCalendarDayClick(type, iso)`: se trova una reservation propria del tipo in quel giorno (`parkingItems`/`deskItems`) apre il modal di cancellazione (`calendarCancelTarget` + Carbon `Modal danger` riusando `api.cancelReservation` + `handleCancelled`). Altrimenti `router.push`. Modal vive in `MyReservationsList` (uno solo, per la calendar). La vista Lista ha già il suo modal in `ReservationsTab`.
- **Modal cancellazione più informativo**: entrambi i modali (vista Lista e vista Calendario) ora elencano Sede, Piano e Zona della prenotazione che si sta per cancellare, oltre a codice posto e data. Utile in contesto multi-sede, dove più posti possono avere lo stesso `code` e l'utente vuole essere certo di star cancellando quello giusto. Lista non ordinata semplice, zona omessa se assente sul posto.
- **Modal di conferma prenotazione più informativo** ([`BookingDialog.tsx`](apps/web/src/components/BookingDialog.tsx)): stesso trattamento, simmetrico al modal cancel. `BookingTarget` esteso con `siteName`, `floorName`, `zoneName: string | null`. [`SpotsBrowser.tsx`](apps/web/src/components/SpotsBrowser.tsx) li popola al click sulla row (sede dal filtro corrente — sempre obbligatorio, piano da `floorById`, zona da `spot.zoneName`).
- **Deep link `?date=...` apre in Lista** ([`SpotsBrowser.tsx`](apps/web/src/components/SpotsBrowser.tsx)): atterrando su `/parking?date=2026-06-15` (click su un giorno nel calendario di /my-reservations) la pagina parte già in vista Lista filtrata sul giorno scelto, invece che in Calendario di default. Coerente con l'intent "guarda i posti di QUEL giorno". Default Calendario resta per gli accessi senza query string.

## 2026-06-09 — Calendario su /my-reservations + bug fix + MAX_DAYS_AHEAD da env

Tre interventi piccoli sopra la feature calendario.

- **Bug fix bordo `--mine` su SpotsBrowser** ([`SpotsBrowser.tsx`](apps/web/src/components/SpotsBrowser.tsx)): l'effect che popolava `myReservedDates` filtrava solo per `r.spot.type`. Cambiando sede/piano restavano bordi "fantasma" su giorni in cui l'utente aveva prenotato altrove. Aggiunti i filtri `r.spot.floor.site.id !== siteId` e `r.spot.floor.id !== floorId`, e relativi `siteId`/`floorId` alle deps dell'effect (refetch al cambio filtro: lo stesso pattern del fetch availability).
- **`MAX_DAYS_AHEAD` da env var**: prima era hardcoded `30` in 3 posti (`spots.service.ts`, `reservations.service.ts`, `SpotsCalendar.tsx`) + 1 const orfana in shared.
  - Backend: nuovo modulo [`apps/api/src/common/business-rules.ts`](apps/api/src/common/business-rules.ts) che legge `process.env.MAX_DAYS_AHEAD` (fallback 30). I service lo importano da lì.
  - Frontend: `process.env.NEXT_PUBLIC_MAX_DAYS_AHEAD` letto a build-time in [`SpotsCalendar.tsx`](apps/web/src/components/SpotsCalendar.tsx). Le due env vanno tenute in pari.
  - `.env.example` aggiornato con commento dedicato.
  - Rimossa la const `MAX_DAYS_AHEAD` orfana da [`packages/shared/src/reservation.schema.ts`](packages/shared/src/reservation.schema.ts) (non era importata da nessuno).
- **Vista Calendario su /my-reservations**:
  - Toggle Lista/Calendario a livello pagina (Carbon `ContentSwitcher`, condiviso tra i due tab PARKING/DESK).
  - Calendario in modalità **`showAvailability=false`**: niente fetch disponibilità, niente pallini. Solo bordo blu sui giorni della propria lista (calcolati inline da `parkingItems`/`deskItems`). Click su un giorno qualsiasi entro il range valido naviga a `/parking?date=YYYY-MM-DD` o `/desks?date=...` per prenotare un nuovo posto.
  - Aggiunta prop `showAvailability?: boolean` (default `true`) a [`SpotsCalendar.tsx`](apps/web/src/components/SpotsCalendar.tsx): skip del fetch + cella cliccabile in tutto il range valido (non più dipendente da `info`).
  - Deep link: aggiunta prop `initialDate?: string` a [`SpotsBrowser.tsx`](apps/web/src/components/SpotsBrowser.tsx) con sanitize fallback su today (rifiuta date malformate o nel passato). [`/parking/page.tsx`](apps/web/src/app/(app)/parking/page.tsx) e [`/desks/page.tsx`](apps/web/src/app/(app)/desks/page.tsx) leggono `searchParams.date` e lo propagano.
- **Test data — sede con 1 posto** ([`apps/api/prisma/test-data/seed-1-spot-site.sql`](apps/api/prisma/test-data/seed-1-spot-site.sql)): script SQL idempotente per creare una sede di test con un singolo posto auto, utile per testare l'esaurimento (pallino rosso, riga rossa, 409 al secondo submit). Lanciabile con `psql` o dallo SQL editor di Supabase. Non tocca le altre sedi del seed principale.

## 2026-06-09 — Vista Calendario su /parking e /desks

Toggle "Lista" / "Calendario" in [`SpotsBrowser.tsx`](apps/web/src/components/SpotsBrowser.tsx). In modalità calendario si vede il mese corrente con un pallino verde + numero posti residui per i giorni con disponibilità, rosso per i giorni pieni, grigio per i giorni fuori range (`oggi → oggi+30gg`). I giorni con propria prenotazione attiva del tipo (PARKING/DESK) hanno bordo blu (Carbon blue-60). Click su un giorno disponibile → setta `date` e torna alla Vista Lista.

**Decisione iniziale**: il TODO prevedeva la calendar su `/my-reservations`, ma in discussione è emerso che il caso d'uso ("vedo il mese e scelgo quando prenotare") porta valore solo nel flow di booking. `/my-reservations` resta una lista. TODO aggiornato di conseguenza.

- **Backend**:
  - Nuovo endpoint `GET /spots/availability?from&to&type&siteId?&floorId?` ([`spots.controller.ts`](apps/api/src/spots/spots.controller.ts)).
  - [`SpotsService.availability()`](apps/api/src/spots/spots.service.ts): due query (spots filtrati + reservations ACTIVE in range), group-by-date in memoria, output `[{date, available, total}]`. Range cap a `MAX_DAYS_AHEAD+1` per evitare payload abnormi.
  - Schemi Zod: [`SpotsAvailabilityQuerySchema` + `SpotsAvailabilityDaySchema`](packages/shared/src/spot.schema.ts).
- **Frontend**:
  - Nuovo componente [`SpotsCalendar.tsx`](apps/web/src/components/SpotsCalendar.tsx) (~250 righe, griglia 7×N custom). Scartato Carbon `DatePicker inline` perché il flatpickr `onDayCreate` non è esposto come prop e accederci via ref è fragile.
  - Header con prev/next + label mese in italiano (`Intl.DateTimeFormat("it-IT")`); riga giorni-settimana lun-dom; celle giorno con `<button>` (a11y: aria-label informativo, focus-visible Carbon blue).
  - Date in UTC ovunque per coerenza con la colonna Postgres `@db.Date` (gli helper `isoFromUtc`/`todayUtc`/`startOfMonthUtc`/`endOfMonthUtc`/`weekdayIndexLunDom` stanno nel componente).
  - `myReservedDates: Set<string>` calcolato in [`SpotsBrowser.tsx`](apps/web/src/components/SpotsBrowser.tsx) via `api.listMyReservations()` filtrato per `r.spot.type === type`. Effect on-demand: fetch quando `view === "calendar"` e ad ogni `reloadTick` (dopo create/cancel l'overlay si aggiorna).
  - DatePicker filtro Data nascosto in vista Calendario (ridondante: il calendario stesso è il picker).
- **Stili** ([`globals.scss`](apps/web/src/styles/globals.scss)): nuove classi `.rsv-page-header-row`, `.rsv-calendar`, `.rsv-calendar-header/-month-label/-weekdays/-grid`, `.rsv-calendar-day` con varianti `--available/--full/--mine/--disabled/--pad`, `.rsv-calendar-pill--available/--full`. Bordo `--mine` reso con `box-shadow: inset` per non shiftare il layout.
- **Edge case gestiti**: mese che attraversa il limite `oggi+30gg` → backend rifiuterebbe; il client tronca `to` a `oggi+30gg` lato fetch e disegna i giorni oltre come `--disabled`. Mese interamente nel passato/futuro fuori range → nessun fetch, tutte celle grigie. Bottoni prev/next disabled quando il mese adiacente è interamente fuori range.

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
