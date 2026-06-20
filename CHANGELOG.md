# CHANGELOG

Storico delle feature/refactor completati. Le voci più recenti in alto. Le voci aperte stanno in [TODO.md](./TODO.md).

## 2026-06-20 — Chiusure (Closure): festività, manutenzioni, blocchi di sede + menu admin nested

Prima feature di amministrazione "calendariale": l'admin può bloccare giorni (festività, manutenzioni, chiusure di sede) e gli utenti non possono più prenotare per quei giorni. Pacchetto end-to-end (schema DB → API → UI) + ristrutturazione del menu admin per ospitare le 3 sotto-pagine (`/admin/reservations`, `/admin/closures`, futura `/admin/bulk-bookings`).

### Schema & match logic

Nuovo model [`Closure`](apps/api/prisma/schema.prisma) `(id, date, siteId?, spotType?, reason, createdByUserId, createdAt)` + migrazione [`20260620170000_add_closure_model`](apps/api/prisma/migrations/20260620170000_add_closure_model/migration.sql). Niente `@@unique` su `(date, siteId, spotType)` — closure sovrapposte sono permesse di design (es. globale "Natale" + locale "Lavori a Bari").

Match logic in [`ClosuresService.findActive`](apps/api/src/closures/closures.service.ts):
```
spot blocked := exists Closure C where
  C.date = dto.date
  AND (C.siteId IS NULL OR C.siteId = spot.floor.siteId)
  AND (C.spotType IS NULL OR C.spotType = spot.type)
```

Applicato solo in [`ReservationsService.create`](apps/api/src/reservations/reservations.service.ts) → 409 con `reason` italiano. **NON** retroattivo: prenotazioni esistenti su giorni bloccati restano ACTIVE (vedi TODO **C1.1** per analisi cancellazione retroattiva).

### Backend

Nuovo [`ClosuresModule`](apps/api/src/closures/closures.module.ts) con:
- [`ClosuresService`](apps/api/src/closures/closures.service.ts) — esposto a `ReservationsService` (check `assertNotBlocked`) e `SpotsService` (overlay availability + filtro listSpots).
- [`AdminClosuresController`](apps/api/src/closures/admin-closures.controller.ts) (`RolesGuard ADMIN`):
  - `GET /admin/closures?from=&to=&siteId=` — lista filtrabile.
  - `POST /admin/closures` body `{dates: string[], siteId?, spotType?, reason}` — bulk-friendly: una sola call inserisce N closure (utile per festività multiple).
  - `DELETE /admin/closures/:id` — singola.
  - `POST /admin/closures/bulk-delete` body `{ids: string[]}` — multipla, idempotente (P2025 ignorato), ritorna `{deleted: N}`.
- [`ClosuresController`](apps/api/src/closures/closures.controller.ts) (JwtAuthGuard, no admin):
  - `GET /closures?from=&to=&type=` — lista user-level compatta `[{date, reason}]` per popolare l'overlay calendar in /my-reservations dove non sappiamo a priori la sede.

### Impatto sugli endpoint esistenti

- [`SpotsService.list`](apps/api/src/spots/spots.service.ts) cambia shape response da `SpotWithAvailability[]` a `{items, closed, closedReason}`. Quando l'utente seleziona una sede e quel giorno è bloccato, `items: []` + `closed: true` + `reason` → la UI mostra banner "Giorno bloccato" invece della lista. Senza siteId il check Closure è skipped (ambiguità). Il client adatta i 3 consumer (SpotsBrowser, BookForUserDialog, AdminReservationsList).
- [`SpotsService.availability`](apps/api/src/spots/spots.service.ts) aggiunge `closed` + `closedReason` per ogni giorno della response. Schema [`SpotsAvailabilityDay`](packages/shared/src/spot.schema.ts) esteso. Una sola query alla tabella Closure per tutto il range.

### Frontend

- **Menu admin nested** ([`AppShell.tsx`](apps/web/src/components/AppShell.tsx)): NAV con `children`. "Amministrazione" è ora un branch con 3 sotto-voci (Prenotazioni, Chiusure, Caricamento massivo). Render condizionale: `HeaderMenu` Carbon su desktop (dropdown con caret), `SideNavMenu` nel drawer mobile (espandibile, `defaultExpanded` se siamo in una sotto-pagina). L'icona shortcut mobile (HeaderGlobalAction "Amministrazione") apre un `HeaderPanel` con `SwitcherItem` per i sotto-link, idiomatico Carbon (simmetrico al menu utente).
- **Pagina `/admin/closures`** ([`AdminClosuresList.tsx`](apps/web/src/components/AdminClosuresList.tsx)):
  - Tabella con sort sulle 6 colonne (Data, Sede, Tipo, Motivo, Creato da, Creato il), pattern uguale a admin/reservations.
  - `FiltersPanel` collassabile sopra: Sede + Tipo (client) + Da + A.
  - Multi-select via `TableSelectAll` + `TableSelectRow`. Bottone "Rimuovi selezionate (N)" `kind="danger--tertiary"` visibile solo con N>0.
  - Modal "Aggiungi chiusura" con calendar inline (riusa `SpotsCalendar` con `showAvailability=false` e `unboundedNavigation`): click su cella → toggle nel Set, click di nuovo rimuove. Le date scelte appaiono come `Tag filter` rimovibili sotto. Carbon non supporta `datePickerType="multiple"` → questa è la soluzione scalabile.
  - Modal di delete singola e modal di bulk-delete con conferma.
- **Calendar utente** ([`SpotsCalendar.tsx`](apps/web/src/components/SpotsCalendar.tsx)):
  - Nuova classe `.rsv-calendar-day--closed` ([`globals.scss`](apps/web/src/styles/globals.scss)): sfondo Carbon gray-20 + pattern strisce diagonali leggere, `cursor: not-allowed`, click disabilitato. Aria-label e title col reason.
  - Nuova prop `closuresByDate?: Map<string, string>` come overlay esterno: il calendar legge le closure da DUE fonti (response listAvailability `info.closed`, oppure prop esterna se disponibile) — la prima usa l'una, /my-reservations usa l'altra (no fetch availability).
  - Nuova prop `unboundedNavigation`: estesa per liberare anche `disabled` (fix bug latente in /my-reservations dove il click su date passate era disabilitato).
  - Edge case "ho una prenotazione in giorno bloccato" (admin aggiunge blocco DOPO la mia create): cella grigia + bordo blu, click resta abilitato per cancellare. Override CSS `.rsv-calendar-day--mine.rsv-calendar-day--closed { cursor: pointer }`.
- **Calendar admin** ([`AdminReservationsCalendar.tsx`](apps/web/src/components/AdminReservationsCalendar.tsx)): nuova prop `closuresByDate`. Padre fa fetch dedicata `api.listAdminClosures({from, to, siteId})` filtrata client-side per type. Cella grigia + reason ma click sempre abilitato (l'admin gestisce prenotazioni preesistenti su giorni bloccati). Override CSS `.rsv-admin-calendar-day.rsv-calendar-day--closed { cursor: pointer }`.
- **Banner "Giorno bloccato"** in `/parking` e `/desks` vista lista ([`SpotsBrowser.tsx`](apps/web/src/components/SpotsBrowser.tsx)): `InlineNotification kind="warning"` sopra la tabella + lista nascosta quando `res.closed`. Distinto dal banner "Nessun risultato" (filtri troppo restrittivi).
- **API client** ([`api.ts`](apps/web/src/lib/api.ts)): `listClosures` (user), `listAdminClosures`, `adminCreateClosures`, `adminDeleteClosure`, `adminBulkDeleteClosures`. Cambio shape `listSpots`/`listAdminSpots` propagato.

### Note di design

- **Click admin su giorno bloccato resta abilitato** (sia in calendar admin che in admin/closures): l'admin deve poter gestire eccezioni e cancellare retroattivamente. Pattern admin-vs-user esplicito.
- **Bulk-friendly fin dall'inizio**: sia POST che bulk-delete accettano array di id/date in una sola call. La UI di /admin/closures sfrutta entrambi (creazione N date + cancellazione N selezionate).
- **Endpoint user `/closures` separato da `/admin/closures`**: payload compatto (solo date + reason, no audit), pensato per l'overlay del calendar non per amministrare.

## 2026-06-20 — `/my-reservations` come `/admin/reservations`: counts, banner per-tab, calendar↔lista coordinati

Pacchetto di rifiniture che uniforma `/my-reservations` al pattern di `/admin/reservations` (tab gestisce sia calendar che lista con una fetch unica), introduce parametri configurabili e sistema diversi micro-bug emersi nei round di test.

### Backend

- **`listMine` accetta `type`** ([`reservations.service.ts`](apps/api/src/reservations/reservations.service.ts), [`ReservationsRangeQuerySchema`](packages/shared/src/reservation.schema.ts)): la UI ora chiama `/reservations/me?type=PARKING|DESK` una volta per tab. Con questo `MY_LIST_LIMIT` e `truncated` valgono **per-tipo** invece che sull'aggregato (prima 5 PARKING + 5 DESK con LIMIT=8 davano "8 totali, truncated=true mescolato").
- **Lettura libera nel tempo** in `listMine`: `from`/`to` ora usano `parseDateOnly` (solo formato) invece di `parseDateUtc` (range `[oggi, oggi+MAX_DAYS_AHEAD]`). Distinzione semantica: `MAX_DAYS_AHEAD` vincola le **azioni** (`create`), non la lettura — l'utente può vedere prenotazioni passate (es. storico) e oltre il limite, anche se non può crearne lì.
- **Limiti list configurabili via env**: nuove costanti `ADMIN_RESERVATIONS_LIST_LIMIT` (default 500) e `MY_RESERVATIONS_LIST_LIMIT` (default 100) in [`shared/reservation.schema.ts`](packages/shared/src/reservation.schema.ts), sovrascrivibili rispettivamente da `process.env.ADMIN_RESERVATIONS_LIST_LIMIT` e `process.env.MY_RESERVATIONS_LIST_LIMIT` via helper `envInt(name, fallback)` (stesso pattern di `MAX_DAYS_AHEAD`). Letti al boot del modulo Nest. I valori shared sono solo default — il `limit` mostrato nel banner arriva sempre dalla response, così il client riflette il valore reale del server.
- **Sort default DESC** ([`listMine`](apps/api/src/reservations/reservations.service.ts), [`findAdminItems`](apps/api/src/reservations/reservations.service.ts)): la prima riga in alto è la prenotazione di data più alta (più "recente nel tempo"). In combinazione con la troncatura admin: i 500 risultati visibili sono i 500 **più recenti** invece dei 500 più vecchi — più utile in pratica.

### Refactor `/my-reservations` (allineamento al pattern admin)

- **Tab gestisce calendar + lista**: il sotto-componente `ReservationsTab` riceve `view` come prop e renderizza internamente sia `<SpotsCalendar>` (vista calendar) che la `<DataTable>` (vista lista). Una sola fetch per `type+from+to`, alimenta entrambe le viste. La fetch globale del padre è stata rimossa.
- **Tab counts per-tipo lift up**: il padre `MyReservationsList` tiene `parkingCount`/`deskCount` (`number | null`), valorizzati dai tab via `onCountChange` callback. Label: "Posti auto (3)" / "Scrivanie (3)". Identico al pattern `/admin/reservations`.
- **Banner "Risultati troncati" per-tab**, sopra la tabella e anche in vista calendar (utile se un mese supera LIMIT). Prima era globale sopra i Tabs, distante dal contenuto a cui si riferiva.
- **Filtri riordinati come admin** in vista lista (2 righe `auto-fit minmax(260px,1fr)`): riga 1 = Sede + Piano + Zona (label esplicita aggiunta); riga 2 = Da + A. Sostituiti il vecchio DatePicker singolo "Data" + il filtro zona separato.
- **Modal cancel unificato**: stesso modal apre da click riga (lista) e da click giorno-mio (calendar) — niente più due Modal duplicati nel padre e nel tab.

### Calendar UX

- **Auto-set Da/A al mese visualizzato in vista calendar** (entrambe le pagine): nuova prop `onMonthChange?: (firstOfMonthUtc: Date) => void` su [`SpotsCalendar`](apps/web/src/components/SpotsCalendar.tsx) e [`AdminReservationsCalendar`](apps/web/src/components/AdminReservationsCalendar.tsx). Il tab ascolta solo in `view === "calendar"` e setta `dateFrom = "YYYY-MM-01"`, `dateTo = "YYYY-MM-{lastDay}"`. Vantaggio: in vista calendar `LIMIT` e `truncated` riflettono il **mese**, non l'intero dataset; cambio mese → re-fetch del nuovo mese.
- **Mese ricordato tra view changes**: nuova prop `initialMonth?: Date` sui calendar. Il padre passa `dateFrom ? dateFromIso(dateFrom) : undefined` — al rimount (passaggio list→calendar→list) il calendar parte dal mese di `dateFrom` corrente, non sempre da oggi. Coerenza con i Da/A che già "ricordavano" lo stato.
- **Calendar resta sempre montato durante il loading**: il pattern `loading ? <Spinner/> : <Calendar/>` smontava il calendar ad ogni fetch — il `currentMonth` interno si resettava a oggi al rimount. Ora `<InlineLoading>` appare in aggiunta sopra il calendar, senza smontarlo. Bug critico: senza questo fix, cliccare prev/next era impossibile (effetto "ritorno al mese corrente" istantaneo).
- **`unboundedNavigation` per `SpotsCalendar`** (default `false`): quando `true` (usato in `/my-reservations`) prev/next sono sempre abilitati. La lettura non è vincolata da `MAX_DAYS_AHEAD`. In `/parking` e `/desks` resta bound (non puoi navigare a mesi in cui non puoi prenotare).
- **DatePicker `/parking` e `/desks` con `maxDate`** ([`SpotsBrowser.tsx`](apps/web/src/components/SpotsBrowser.tsx)): aggiunto `maxDate={maxIso()}` (oggi + `MAX_DAYS_AHEAD`) accanto al `minDate` già esistente. Flatpickr disabilita visivamente le celle fuori range — niente più "clic su data fuori limite → errore backend".
- **Hover di default sulle celle calendar** ([`globals.scss`](apps/web/src/styles/globals.scss)): aggiunto `:hover { background: #f4f4f4 }` (Carbon gray-10) a `.rsv-calendar-day` base. Risolve il caso in cui le celle senza variante semantica (tipico in `/my-reservations` con `showAvailability=false`) non avevano feedback hover sul wrapper colorato. Le varianti `--available`/`--full`/`--disabled`/`--has-items` mantengono i loro hover specifici (override).

### Mobile / UI

- **Logo Home su mobile** ([`AppShell.tsx`](apps/web/src/components/AppShell.tsx), [`globals.scss`](apps/web/src/styles/globals.scss)): un solo `<HeaderName>` mostra "IBM Reservation" su desktop e l'icona Home (Carbon `Home`) su mobile. Sotto Carbon `$breakpoint-md = 672px`, il prefix Carbon `cds--header__name--prefix` e il testo `rsv-brand-text` vengono nascosti via CSS — resta visibile solo l'SVG, e la `HeaderGlobalBar` di destra recupera lo spazio per il bottone Esci che prima veniva tagliato.
- **Padding ridotti su mobile**: il `<Content>` Carbon ora ha classe `rsv-app-content` (era `style` inline non responsive). Cascata su mobile (≤671px): `Content` 0 + `<main>` 0.5rem + `.rsv-spot-tab` 0.75rem (era ~5.5rem totali). I DatePicker stretti rientrano nei wrapper colorati senza overflow.

### Bug fix

- **Redirect post-login bypassava la dispatch per ruolo** ([`login/page.tsx`](apps/web/src/app/login/page.tsx)): il bottone forzava `callbackUrl: "/my-reservations"` hardcoded, e admin finivano lì invece che su `/admin/reservations`. Ora `callbackUrl` è letto da query string (`?callbackUrl=...` valorizzato dal middleware withAuth quando rimanda da una pagina protetta) con **fallback `/`** così `page.tsx` può fare la dispatch per ruolo.
- **Errore di update/cancel ora dentro al modale** ([`AdminReservationsList.tsx`](apps/web/src/components/AdminReservationsList.tsx)): il caso "il nuovo utente ha già una prenotazione per quel giorno" (P2002 → 409) era un'`InlineNotification` sopra la tabella, nascosta dietro l'overlay del modale aperto. Ora è dentro al modale (il modale resta aperto così l'admin corregge la selezione e ritenta). Cambio selezione utente nel ComboBox resetta automaticamente l'errore.



Rifiniture a valle dei round su /admin/reservations + dettagli UX trasversali a tutta l'app.

- **Trasferimento prenotazione admin** (cambio intestatario): nuovo endpoint [`PATCH /admin/reservations/:id`](apps/api/src/reservations/admin-reservations.controller.ts) con body `{ userId }` → [`ReservationsService.adminUpdate`](apps/api/src/reservations/reservations.service.ts) (atomico: una sola `prisma.update`, niente cancel+create). Il vincolo unique partial `(userId, date, spotType) WHERE active` protegge: se il nuovo utente ha già una prenotazione per stesso giorno+tipo, P2002 → 409 con messaggio italiano. Schema [`AdminUpdateReservationSchema`](packages/shared/src/reservation.schema.ts).
  - Frontend: il modale che prima era solo "Cancella" diventa modale **di gestione**. Default identico a prima (bottone rosso "Cancella"); l'admin clicca "Cambia utente" inline accanto al nome → ComboBox preselezionato sull'utente attuale; quando seleziona un nome diverso il bottone si trasforma in arancione "Aggiorna" (Carbon orange-50 `#ff832b` via classe `.rsv-modal-update`, vedi [`globals.scss`](apps/web/src/styles/globals.scss); Carbon non ha un kind nativo "warning" per Button). Se riseleziona se stesso o cancella la selezione → torna a "Cancella" rosso. Niente form a parte: stesso modale, stessa entry-point (click riga ACTIVE).
  - API client [`api.adminUpdateReservation(id, userId)`](apps/web/src/lib/api.ts).
  - Use case: errori di intestazione, scambio posto fra colleghi, cessione prenotazione last-minute. Mantiene `id`, `createdAt`, audit della riga (cambia solo `userId` e `updatedAt`).

- **Atterraggio per ruolo dopo login** ([`apps/web/src/app/page.tsx`](apps/web/src/app/page.tsx)): il redirect post-login distingue `ADMIN` → `/admin/reservations` (panoramica admin) vs `USER` → `/my-reservations` (dashboard personale). Prima `USER` veniva mandato a `/parking`, ma "Le mie prenotazioni" è il punto di partenza più sensato: l'utente vede subito il proprio stato e da lì decide se prenotare nuovo (link "Prenota qui i posti auto / la tua scrivania" già presenti sopra i tab). Le altre voci nav restano comunque tutte raggiungibili.

- **Cerchio "oggi" in tutti i calendari** ([`globals.scss`](apps/web/src/styles/globals.scss), [`SpotsCalendar.tsx`](apps/web/src/components/SpotsCalendar.tsx), [`AdminReservationsCalendar.tsx`](apps/web/src/components/AdminReservationsCalendar.tsx)): pattern Google Calendar — il numero del giorno corrente è dentro un cerchietto Carbon gray-70 con testo bianco bold. Coesiste senza override con tutti gli stati (`--available`, `--full`, `--mine`, `--has-items`, `--disabled`) perché lo stile è applicato solo al `<span>` del numero, non al background della cella. Itinerario di scelta: scartato sfondo blu chiaro (collideva con `--has-items` admin), scartato outline cella (creava bordi doppi con `--mine`), scelto il cerchio per affidabilità cromatica e familiarità. Su mobile il cerchio si riduce a 1.25rem per non occupare troppo spazio.

- **ComboBox per il campo "Posto" nel `BookForUserDialog`** ([`BookForUserDialog.tsx`](apps/web/src/components/BookForUserDialog.tsx)): sostituito il `Select` con `ComboBox` (typeahead + dropdown scrollabile, stesso pattern del filtro Utente). Per dataset >50 spot lo scroll cieco era ingestibile; ora l'admin digita "P-15" o "Zona Nord" e la lista si filtra in tempo reale.

- **Admin bypassa i vincoli temporali** (per inserimento storico HR / pianificazione lunga). Aggiunto opt `unrestrictedDate` a [`SpotsService.list`](apps/api/src/spots/spots.service.ts) e [`ReservationsService.create`](apps/api/src/reservations/reservations.service.ts): quando `true` usa `parseDateOnly` (solo formato) invece di `parseDateUtc` (range `[oggi, oggi+MAX_DAYS_AHEAD]`).
  - Nuovo endpoint [`GET /admin/spots`](apps/api/src/spots/admin-spots.controller.ts) con `RolesGuard ADMIN` che chiama `SpotsService.list(q, { unrestrictedDate: true })`.
  - [`AdminReservationsController.create`](apps/api/src/reservations/admin-reservations.controller.ts) passa `{ unrestrictedDate: true }` a `reservations.create`.
  - Frontend [`api.listAdminSpots`](apps/web/src/lib/api.ts) usato dal dialog al posto del `listSpots` user; rimosso `minDate` dal DatePicker del dialog.
  - Vincoli che restano validi anche per admin: spot deve essere `active`, vincolo unique `(userId, date, spotType)` ACTIVE (regole DB-enforced del `CHANGELOG.md`).

- **Sfondo distintivo per tipo posto** in **tutte** le pagine che hanno un "tipo" (`/parking`, `/desks`, `/admin/reservations`, `/my-reservations`) — [`AdminReservationsList.tsx`](apps/web/src/components/AdminReservationsList.tsx), [`MyReservationsList.tsx`](apps/web/src/components/MyReservationsList.tsx), [`SpotsBrowser.tsx`](apps/web/src/components/SpotsBrowser.tsx), [`globals.scss`](apps/web/src/styles/globals.scss). Classe `rsv-spot-tab rsv-spot-tab--{type}` su ogni wrapper (Tab content per le pagine multitipo, `<main>` per `/parking` e `/desks` che sono pagine singole). Coerenza visuale across navigation: l'utente che clicca un giorno nel calendar di `/my-reservations` viene rimandato a `/parking?date=...` e ritrova lo stesso lavender — "stessa famiglia".
  - **`--parking`**: Carbon purple-20 `#e8daff` (lavender, "veicolo"). Iniziale `purple-10` era troppo chiaro per emergere dalla pagina bianca.
  - **`--desk`**: Carbon yellow-10 `#fcf4d6` (caldo, "wood/scrivania")
  - Entrambi distintivi dagli stati semantici dei calendar (verde `--available`, rosso `--full`, blu `--has-items`) e fra di loro.
  - Il colore si vede come **cornice** attorno al contenuto: il calendar ha celle bianche, la DataTable righe bianche. Padding generoso (1.5rem) lo rende abbastanza presente senza invadere l'area di contenuto.

## 2026-06-20 — Admin: azioni "Prenota per utente" e "Cancella prenotazione altrui"

Estesa la pagina `/admin/reservations` con due azioni sulle prenotazioni di altri utenti, mantenendo invariate le 11 regole business (vincolo unique user/day/type, range data, spot active). UX scelta: bottoni nella vista Lista (no menu contestuale al click giorno) — pattern consolidato del progetto, niente layer aggiuntivi.

### Backend
- **Schema** [`AdminCreateReservationSchema`](packages/shared/src/reservation.schema.ts) (Zod): `{ userId, spotId, date }`. Validato in `AdminReservationsController`, protetto da `RolesGuard ADMIN`.
- **Service** [`ReservationsService.cancel`](apps/api/src/reservations/reservations.service.ts): firma estesa con terzo parametro `opts: { isAdmin?: boolean }`. Quando `isAdmin=true` il check `r.userId !== userId` viene bypassato; il `userId` passato è quello dell'admin chiamante (utile per audit, non per il permesso). Mantenuto 404 NotFound su id inesistente per non leakare informazioni.
- **Service** [`ReservationsService.create`](apps/api/src/reservations/reservations.service.ts): nessuna modifica — già accetta `userId` esplicito come primo argomento. L'admin chiama con `userId` target.
- **Controller** [`AdminReservationsController`](apps/api/src/reservations/admin-reservations.controller.ts): 
  - `POST /admin/reservations` → `reservations.create(dto.userId, { spotId, date })` (riusa la stessa logica di create user normale).
  - `DELETE /admin/reservations/:id` → `reservations.cancel(admin.id, id, { isAdmin: true })`.
  - Iniettato anche `UsersService` per risolvere l'admin chiamante dal token.

### Frontend
- **API client** ([`api.ts`](apps/web/src/lib/api.ts)): `adminCreateReservation(dto)` e `adminCancelReservation(id)`.
- **`BookForUserDialog`** ([nuovo file](apps/web/src/components/BookForUserDialog.tsx)): Carbon `Modal` con form a 5 campi:
  - Utente (Carbon `ComboBox` single-select, typeahead client-side sul dataset preloaded)
  - Sede (Select, popolata da `listSites`)
  - Piano (Select, dipende da Sede via `listFloors`)
  - Data (DatePicker, preimpostata se l'admin arriva da click su un giorno del calendar)
  - Posto (Select, popolato da `listSpots(date, sede, piano, type)` filtrato `available=true`; etichetta `"<code> — <zona>"`)
  - Tipo: preimpostato dal Tab corrente (PARKING/DESK), mostrato nel titolo del modal.
  - Cleanup guard sul fetch spots, banner "Nessun posto disponibile" se la combinazione filtri non lascia spot prenotabili.
- **`AdminReservationsList`** ([modificato](apps/web/src/components/AdminReservationsList.tsx)):
  - Toolbar passata da `flex-end` a `space-between`: bottone `<Add /> Prenota per utente…` (Carbon tertiary) a sinistra **visibile solo in vista Lista**, IconButton `Renew` a destra (invariato).
  - Click "Prenota per utente…" → apre `BookForUserDialog` con `type` corrente. Se i filtri Da/A coincidono su un singolo giorno, quella data è preimpostata.
  - **Cancellazione via click sulla riga** (pattern `MyReservationsList`): le righe `ACTIVE` hanno classe `.rsv-row-clickable` + tooltip "Clicca per cancellare la prenotazione" → modal cancel. Le `CANCELLED` non sono cliccabili (cursor default, no hover). Scartata l'idea di una colonna "Azioni" con `IconButton TrashCan`: con 9 colonne già esistenti la nuova colonna finiva fuori dal viewport e richiedeva scroll orizzontale.
  - Modal di cancellazione mostra contesto completo (utente + sede + piano + zona + codice + data) per evitare cancel accidentali su grandi liste. Submit → `adminCancelReservation` → toast successo + reload.
  - Banner success unificato per entrambe le azioni: "Prenotazione creata con successo." / "Prenotazione di {utente} del {data} ({codice}) cancellata."

### File toccati / creati

**Modificati**:
- `packages/shared/src/reservation.schema.ts`
- `apps/api/src/reservations/reservations.service.ts`
- `apps/api/src/reservations/admin-reservations.controller.ts`
- `apps/web/src/lib/api.ts`
- `apps/web/src/components/AdminReservationsList.tsx`

**Creato**:
- `apps/web/src/components/BookForUserDialog.tsx`

### Limiti accettati
- L'admin che cancella una prenotazione di un altro utente **non manda notifica all'utente** (no email, no in-app). Aggiunto avviso esplicito nel modal: "L'operazione è immediata. L'utente non riceve notifica.". Quando arriverà il sistema di notifiche aziendale, riconsidereremo.
- "Prenota per utente" applica le stesse regole di un user normale: l'admin **non può** creare prenotazioni nel passato o oltre `MAX_DAYS_AHEAD`. Non c'è un override esplicito perché casi d'uso reali (es. inserimento storico per HR) sono ancora da capire.

## 2026-06-19 — Pagina Admin `/admin/reservations` (read-only, in stile `/my-reservations`)

Implementato il **primo step** della "Pagina Admin / HR / Manager" del TODO. La spike Entra ID (Q1 — ruoli/riporti) resta aperta in attesa di confronto con HR; partiamo intanto dalla **sola visibilità** con il binario `USER`/`ADMIN` già in vigore. Niente azioni (cancel di altri / create-for-others), niente `MANAGER` con scoping riporti — sono i prossimi incrementi.

**Outcome**: un utente con `role === "ADMIN"` (email in `ADMIN_EMAILS`) accede a `/admin/reservations` e vede tutte le prenotazioni del sistema. UX strutturata come `/my-reservations`: toggle **Calendario / Lista** + tabs **Posti auto / Scrivanie** + filtri ricchi inclusa selezione multipla utenti.

### Backend
- **Endpoint `GET /admin/reservations`** con `RolesGuard(['ADMIN'])`, in nuovo file [`admin-reservations.controller.ts`](apps/api/src/reservations/admin-reservations.controller.ts) (separato dal `reservations.controller.ts` per non mescolare paths). Riusa `ReservationsService` di `ReservationsModule`. Quando aggiungeremo `/admin/closures` e `/admin/settings` valuteremo se estrarre un `AdminModule`.
- **Endpoint `GET /admin/users`** in [`admin-users.controller.ts`](apps/api/src/users/admin-users.controller.ts): popola il `FilterableMultiSelect` lato frontend. Niente paginazione: per MVP la lista è piccola; quando supererà 500 utenti passiamo a typeahead remoto.
- **Schema** [`AdminReservationsQuerySchema`](packages/shared/src/reservation.schema.ts) — campi opzionali `siteId, floorId, zoneName, type, status, from, to, userIds[]`. `userIds` accetta sia singolo (`?userIds=a`) sia multipli (`?userIds=a&userIds=b`) via `z.union + transform` che normalizza ad array. Costante `ADMIN_RESERVATIONS_LIMIT = 500`.
- **`ReservationsService.listAdmin`**: filtri opzionali, `where.userId = { in: userIds }` (più efficiente del precedente ILIKE su email/displayName), composizione del `where.spot` riorganizzata per supportare ortogonalmente `siteId|floorId + zoneName` (text search ILIKE su `Zone.name`). `take: limit + 1` per scoprire la troncatura in una sola query → ritorna `{items, truncated, limit}`. Niente default su `status`: il client decide.
- **Helper `parseDateOnly()`**: variante di `parseDateUtc` senza vincoli temporali — admin filtra nel passato e oltre `MAX_DAYS_AHEAD`.

### Frontend
- **Voce nav** condizionale in [`AppShell.tsx`](apps/web/src/components/AppShell.tsx): "Amministrazione" → `/admin/reservations`, icona Carbon `Group`. Visibile solo se `session.user.role === "ADMIN"` (filtro `visibleNav`); coerente in `HeaderNavigation` desktop, `HeaderGlobalAction` icone mobile, `SideNav` drawer.
- **API client** ([`api.ts`](apps/web/src/lib/api.ts)): tipi `AdminReservation`, `AdminReservationsResponse`, `AdminReservationsQuery`, `AdminUserItem`; metodi `listAdminReservations` e `listAdminUsers`.
- **Page** [`/admin/reservations/page.tsx`](apps/web/src/app/(app)/admin/reservations/page.tsx) (server component sottile) → renderizza `AdminReservationsList`.
- **Componente** [`AdminReservationsList`](apps/web/src/components/AdminReservationsList.tsx) in stile `MyReservationsList`:
  - **Toggle Calendario / Lista** (`ContentSwitcher`, default Calendario) condiviso tra i tab.
  - **Tabs PARKING / DESK** (Carbon `Tabs` controllati per evitare reset al rerender). Il filtro Tipo non è più nei filtri — è il Tab attivo.
  - Sotto-componente `AdminReservationsTab` con stato indipendente per tab (replica del pattern `MyReservationsList → ReservationsTab`).
  - **Filtri** organizzati in 3 righe semantiche dentro `FiltersPanel` collassabile:
    - Riga 1 (spazio): Sede, Piano, Zona (Search ILIKE come `/my-reservations`)
    - Riga 2 (tempo + stato): Stato (default ACTIVE), Da, A
    - Riga 3 (utenti): `FilterableMultiSelect` Carbon con dataset preloaded, typeahead built-in
  - Ogni riga è un grid `auto-fit + minmax(200px, 1fr)` con `align-items: start` + `row-gap`: i campi si distribuiscono a piena larghezza e vanno a capo solo internamente alla loro riga, evitando l'overlap di label che si verificava con un singolo grid 6+ figli.
  - **Lista**: `DataTable` Carbon con 9 colonne (Data, Utente, Codice, Sede, Piano, Zona, Stato, Creata il, Cancellata il), sort per colonna, banner truncated. Read-only: niente click, niente modal cancel.
- **Calendar admin** ([`AdminReservationsCalendar.tsx`](apps/web/src/components/AdminReservationsCalendar.tsx)): nuovo componente dedicato. Riusa la grid 7×N + header navigation di `SpotsCalendar` ma con tre differenze chiave:
  - **Niente bound `MAX_DAYS_AHEAD`**: l'admin naviga liberamente prev/next nel passato/futuro.
  - **Niente fetch interna**: aggrega lato client gli `items` di `listAdminReservations` in un `Map<iso, count>`. Cella sempre cliccabile (anche count = 0).
  - **Stato visivo**: cella vuota se 0 prenotazioni; sfondo Carbon blue-10 + badge blue-60 col count se ≥ 1; **sfondo red-10 + badge red-60 quando "esaurito"** (count >= `totalCapacity` del filtro corrente). La capacity è fetchata via `api.listSpots()` con `date=today`, filtrata client-side per `zoneName` (listSpots non lo supporta nativamente).
  - Click giorno → setta `dateFrom = dateTo = iso` sul tab e switcha a vista Lista (callback dal tab al parent). Coerente col pattern "calendar = panoramica, lista = dettaglio".

### Sicurezza (doppia protezione)
- **Backend**: `RolesGuard` su `AdminReservationsController` e `AdminUsersController`. Fonte di verità del check accesso è il claim `role` del JWT.
- **Frontend**: [`middleware.ts`](apps/web/src/middleware.ts) intercetta `/admin/:path*` e fa redirect a `/403` (page dedicata sotto `(app)`) quando `token.role !== "ADMIN"`. UX più pulita di "pagina admin con banner errore" — l'utente non admin non vede mai la struttura della pagina admin.

### Allineamento DB ↔ JWT al login
Prima `User.role` a DB era un campo dormiente, popolato al primo provisioning e mai più aggiornato. Ora il callback `jwt` di [`lib/auth.ts`](apps/web/src/lib/auth.ts) chiama `GET /me` del backend ad ogni nuovo login (`account && profile` truthy), con un JWT firmato `HS256` come fa il proxy BFF — questo scatena `provisionFromToken()` che riallinea `User.role` col valore appena calcolato da `ADMIN_EMAILS`. Side effect fire-and-forget. Il check accessi resta comunque basato sul JWT, il DB è una denormalizzazione utile per future query analitiche.

### Limiti accettati per MVP
- I count del calendar derivano dagli stessi 500 max righe della lista. Se un mese supera il limite, alcuni giorni avranno count basso. Banner "Risultati troncati" mostrato in vista Lista, omesso in calendario per non duplicare.
- Endpoint `/admin/users` senza paginazione (vedi sopra).
- Tabella admin con 9 colonne è poco usabile su mobile: aggiunta nota in [TODO.md](TODO.md) per analizzare card layout / colonne nascondibili dopo aver visto l'uso reale.
- Revoca privilegi ADMIN già loggati: il JWT è "frozen" al login (~30gg session). Token rimosso da `ADMIN_EMAILS` resta valido fino a logout/scadenza. Aggiunta nota in [TODO.md](TODO.md) come blocker pre-go-live, da decidere insieme a Q1 (Entra ID).

## 2026-06-11 — Etichetta "Sede · Codice" nel calendario di /my-reservations

Migliorata la vista Calendario su `/my-reservations`: prima i giorni con propria prenotazione avevano solo un bordo blu, senza indicazione di QUALE prenotazione fosse. Ora la cella mostra anche un'etichetta `"<sede> · <codice>"` (es. `"Bari · P-01"`).

- [`SpotsCalendar.tsx`](apps/web/src/components/SpotsCalendar.tsx): nuova prop opzionale `myReservationLabels?: Map<string, string>`. Quando presente E `showAvailability=false`, la cella renderizza un `<span class="rsv-calendar-day-label">` sotto il numero del giorno. Su `/parking` e `/desks` (che girano con `showAvailability=true`) la prop viene ignorata: lì restano i pallini availability.
- [`MyReservationsList.tsx`](apps/web/src/components/MyReservationsList.tsx): due nuove `useMemo` (`parkingLabels`, `deskLabels`) che mappano `iso → "<site.name> · <spot.code>"` partendo da `parkingItems`/`deskItems`. Passate al rispettivo `SpotsCalendar`.
- [`globals.scss`](apps/web/src/styles/globals.scss): nuova classe `.rsv-calendar-day-label` con ellipsis (testo troncato se la cella è stretta — l'utente può sempre cliccare per aprire il modal con info complete). Font ridotto su mobile (`0.625rem`) per rimanere leggibile nella cella compatta.
- **Fix layout grid del calendar**: senza ulteriori interventi, una cella con label lunga forzava la sua colonna a essere più larga delle altre (col `1fr` puro la grid rispetta la `min-content` di ogni colonna). Risolto con `grid-template-columns: repeat(7, minmax(0, 1fr))` + `min-width: 0` su `.rsv-calendar-day`: le 7 colonne mantengono la stessa larghezza, l'overflow viene gestito dall'`text-overflow: ellipsis` della label.
- **Min-height celle uniforme su mobile**: alzato da `3rem` a `4rem` per fare spazio sempre a numero + (eventuale) label. Senza, le righe con almeno una cella-mio risultavano più alte delle altre, creando un effetto layout traballante.
- A11y: aggiornato `aria-label` della cella per leggere `"9 giugno 2026, prenotazione: Bari · P-01"` quando l'etichetta è presente.

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
