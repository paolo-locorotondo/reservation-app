# TODO

Backlog dei prossimi step, in ordine di priorità da discutere. Voci completate nello storico in [CHANGELOG.md](./CHANGELOG.md).

## Revoca privilegi ADMIN già loggati (sicurezza)

Oggi `token.role` è "frozen" al login: viene calcolato dal callback `jwt` di NextAuth solo quando `account && profile` sono presenti, cioè una sola volta dopo l'OAuth. Conseguenze:

- Se un'email viene **rimossa** da `ADMIN_EMAILS` ma l'utente è già loggato, il suo JWT in tasca rimane `role: ADMIN` per tutta la durata della session (default NextAuth: 30gg). Continua a vedere `/admin/reservations` finché non fa logout (suo!) o la session scade.
- Sintomo opposto: se aggiungo un'email ad `ADMIN_EMAILS` mentre l'utente è già loggato, lui resta `USER` finché non fa logout+login.

Possibili rimedi (da discutere quando i ruoli saranno gestiti definitivamente — vedi sezione successiva):

- (a) **Riduzione `maxAge` JWT**: tipo 8h, così la "blast radius" di un token revocato è limitata alla giornata lavorativa. Trade-off: utenti devono riloggarsi più spesso.
- (b) **Forzare il refresh del token via lookup DB**: nel callback `jwt` (eseguito ad ogni richiesta, non solo al login) confrontare `token.role` con `User.role` a DB. Se diverso, aggiornare `token.role`. Costa 1 query DB per ogni hit del proxy BFF — pesante ma riallinea entro pochi secondi.
- (c) **Token short-lived + refresh**: pattern OAuth standard. Più infrastruttura.

Decisione bloccata da Q1 della sezione successiva (provenienza dei ruoli da Entra ID): se il role arriva da claim Entra, il refresh sarà tipicamente legato a quello. Fino allora, la situazione attuale è accettabile in MVP perché `ADMIN_EMAILS` cambia di rado e non c'è ancora dato sensibile da proteggere. Da rivisitare prima del go-live aziendale.

- **Priority**: 🟡 MED (rilevante prima del go-live, irrilevante in MVP)
- **Stato**: 🔴 TODO

## Pagina /admin/reservations su mobile (tabella troppo larga)

La tabella admin ha 10 colonne (Data, Utente, Tipo, Codice, Sede, Piano, Zona, Stato, Creata il, Cancellata il). Su mobile diventa ingestibile: scroll orizzontale forzato, le righe troncano, l'utente perde il contesto. Essendo una pagina admin il caso d'uso mobile è raro, ma vogliamo comunque qualcosa di leggibile.

Idee da analizzare:

- **Card layout su mobile**: sotto un breakpoint (es. 671px), invece di `<table>` rendiamo ogni prenotazione come una card con label+value. Più verticale, più digestibile sul tap-target di mobile.
- **Colonne nascondibili**: lascia tabella ma nasconde su mobile le colonne secondarie (Codice, Zona, Creata il, Cancellata il). L'admin clicca una riga per vedere il dettaglio in un drawer/modal.
- **Toggle "vista densa / vista comoda"** indipendente dal media: l'admin sceglie.

Da affrontare dopo aver finito le rifiniture funzionali (calendar, multiselect users) e visto come la pagina viene usata in pratica.

- **Priority**: 🟢 LOW
- **Stato**: 🔴 TODO

## Unificare Parking + Desks in una pagina con tab

Oggi sono due pagine separate (`/parking`, `/desks`) che usano lo stesso `SpotsBrowser` con `type` diverso. La proposta è una singola pagina `/spots` (o `/book`) con due tab "Posti auto" / "Scrivanie", come `/my-reservations`.

Pro:

- Coerenza con "Le mie prenotazioni".
- Una sola voce di nav invece di due.
- L'utente può alternare i tab senza ricaricare le sedi/piani.

Contro / da valutare:

- Le due viste hanno filtri identici ma stato indipendente: cambiare tab richiede di mantenere stato per tab (come fatto in `MyReservationsList` con il sotto-componente `ReservationsTab`).
- Il deep-linking (`/parking` linkabile da Slack/email) si perderebbe a meno di passare il tipo via query string (`/spots?type=PARKING`).
- Mobile: due tap (entra in `/spots` + scegli tab) vs uno solo (entra in `/parking`). Su nav laterale Carbon non cambia molto, ma è da considerare.
Decisione da prendere: **unificare** o **lasciare separato**? Nel dubbio, posticipare a dopo aver visto l'uso reale.
- **Priority**: 🟢 LOW
- **Stato**: 🔴 TODO

## Analisi: ruoli, permessi e regole di business

Sezione di **analisi** (non ancora progettazione). Raccoglie tutto ciò che ruota attorno a "chi può fare cosa, e quali parametri sono regolabili senza redeploy". Confluiscono qui due cose che prima erano separate: la pagina Admin/HR (chi vede le prenotazioni altrui) e la gestione delle regole configurabili (festività, posti riservati, parametri).

Tre piani da non confondere:

- **(A) Validazioni "tecniche"**: vincoli di integrità (formati, range, unicità) — già implementati (vedi `CHANGELOG.md` per i dettagli sulle 11 regole in vigore).
- **(B) Permessi per ruolo**: chi può vedere/modificare le prenotazioni di chi. Oggi binario `USER`/`ADMIN`; da estendere quando spike Entra ID risponde a Q1.
- **(C) Eccezioni dinamiche**: dati gestibili da Admin/HR senza redeploy (festività, posti riservati). Ancora da progettare.

### Decisioni prese (storico, riepilogo)

- ✅ **Q2 — granularità**: festività/chiusure e posti riservati sono **per-sede**.
- ✅ **Q3 — parametri configurabili**: restano in env (`MAX_DAYS_AHEAD` cambia 2-3 volte l'anno, redeploy accettabile per ora).
- ✅ **Q4 — modello permessi**: **RBAC** (role-based). Sufficiente per i 3 ruoli previsti USER/MANAGER/ADMIN. Se in futuro spuntano regole "responsabile di Bari vede solo Bari" si valuterà ABAC.
- ⏳ **Q1 — Entra ID** (sotto, ancora aperta).

---

### Direzione futura

#### (B) Permessi per ruolo — evoluzione

Mappatura target a tre livelli:

| Ruolo | Vede | Può prenotare per | Può cancellare per |
|---|---|---|---|
| `USER` (oggi default) | Sé | Sé | Sé |
| `MANAGER` (nuovo, bloccato da Q1) | Sé + i propri riporti | Sé + i propri riporti | Sé + i propri riporti |
| `ADMIN` / `HR` (oggi promosso da ADMIN_EMAILS) | Tutti | Tutti | Tutti |

Tre dimensioni indipendenti che ne discendono (stato per ruolo):
- **Visibilità**: ✅ ADMIN su `/admin/reservations`. Da estendere a MANAGER con scoping riporti.
- **Prenotazione per altri**: ✅ ADMIN via `POST /admin/reservations` (vedi CHANGELOG 2026-06-20). Da estendere a MANAGER con scoping riporti.
- **Cancellazione di altri**: ✅ ADMIN via `DELETE /admin/reservations/:id` con flag `isAdmin` nel service. Da estendere a MANAGER con scoping riporti.

#### (C) Eccezioni e parametri dinamici

##### C1 — Giorni bloccati (Closure) — ✅ implementato (vedi `CHANGELOG.md`)

Festività, chiusure di sede, lavori. Modello concordato:

```prisma
model Closure {
  id        String    @id @default(cuid())
  date      DateTime  @db.Date
  siteId    String?           // null = tutte le sedi
  spotType  SpotType?         // null = entrambi i tipi
  reason    String            // "Festività nazionale", "Manutenzione", ...
  createdAt DateTime  @default(now())
  createdByUserId String
  createdBy User      @relation(fields: [createdByUserId], references: [id])
  site      Site?     @relation(fields: [siteId], references: [id])

  @@index([date])
  @@index([siteId, date])
}
```

Niente `@@unique` su `(date, siteId, spotType)`: vogliamo permettere closure sovrapposte (es. globale "Natale" + locale "Lavori a Bari"). La logica matcha la prima.

**Match logic** (in `ReservationsService.create`):

```
spot blocked := exists Closure C where
  C.date = dto.date
  AND (C.siteId IS NULL OR C.siteId = spot.floor.siteId)
  AND (C.spotType IS NULL OR C.spotType = spot.type)
```

→ `409 ConflictException("giorno bloccato: " + reason)`. Posizionato dopo gli altri check business in `create()`. **NON** applicato in `cancel()` né in `adminUpdate()` (transfer): blocchi aggiunti dopo prenotazioni esistenti non le invalidano (HR le cancella manualmente).

**Endpoint admin**:
- `GET /admin/closures?from=&to=&siteId=` — lista filtrabile per range temporale
- `POST /admin/closures` body `{dates: string[], siteId?, spotType?, reason}` — accetta più date in una call (utile per festività multiple Pasqua/Natale)
- `DELETE /admin/closures/:id`

Tutti protetti da `RolesGuard ADMIN`.

**Backend impact su altre API**:
- `listAvailability` (calendar `/parking`, `/desks`): la response per ogni giorno aggiunge `closed: boolean` + `closedReason: string | null`. Le celle del calendar diventano grigio + lucchetto, click disabilitato.
- `listSpots` (vista lista `/parking`, `/desks`): per la data selezionata, se è bloccata → la lista si svuota e mostra un banner "Giorno bloccato: {reason}". Senza questo, l'utente vedrebbe la lista degli spot disponibili e cliccare uno fallirebbe con 409 (UX peggiore).

**UI**:
- **Calendar utente** (`SpotsCalendar`): nuova classe `.rsv-calendar-day--closed` (background grigio + icona lucchetto + cursor:not-allowed). `aria-disabled` + tooltip = `reason`. Si combina con `--mine` se l'utente per qualche motivo ha già una prenotazione lì (caso edge: blocco aggiunto dopo).
- **Pagina `/admin/closures`**: tabella (Data, Sede, Tipo, Motivo, Creata da, Creata il) + bottone "Aggiungi blocco" (modal con DatePicker `multi` di Carbon per selezionare più date, Sede select con opzione "Tutte", SpotType select con opzione "Entrambi", textarea Motivo). Voce nav "Blocchi" sotto "Amministrazione" (visibile solo ADMIN).

**Stima**: 1-2 giornate. File toccati: prisma schema + migrazione, nuovo `ClosuresService` + `AdminClosuresController`, `ReservationsService.create` (check), `SpotsService.listAvailability` (closed flag), nuova pagina admin `/admin/closures/page.tsx`, nuovi componenti `<ClosuresList>` e `<AddClosureDialog>`, css per `.rsv-calendar-day--closed`, `api.ts` client.

- **Priority**: ✅ FATTO
- **Stato**: ✅ IMPLEMENTATO (vedi CHANGELOG)

##### C1.1 — Cancellazione retroattiva quando un admin blocca un giorno (DA ANALIZZARE)

Oggi, quando un admin crea una `Closure` per un giorno, le prenotazioni esistenti **non vengono toccate**: restano ACTIVE, l'utente può ancora vederle e cancellarle. Comportamento attuale documentato esplicitamente nel modal admin ("Le prenotazioni esistenti per questo giorno NON vengono eliminate automaticamente"). Domande da rispondere prima di cambiarlo:

1. **Vogliamo davvero cancellarle automaticamente?** Casi d'uso che spingono per il sì:
   - Festività dichiarata in ritardo (HR si accorge a maggio che il 25/4 è festivo): le prenotazioni esistenti per quel giorno sono "errate", l'azienda non vuole presenza in ufficio.
   - Manutenzione urgente: il piano è chiuso, gli utenti devono essere avvisati che la loro prenotazione è invalida.

   Casi che spingono per il no:
   - Festività "ufficiali ma con ufficio aperto" (lavoratori a turni). Cancellare automaticamente sarebbe sbagliato.
   - Closure parziali (es. solo PARKING bloccato): le DESK prenotate restano valide.

2. **Come gestire la notifica all'utente?** Cancellare senza avvisare è scorretto. Oggi non abbiamo un canale di notifiche aziendale (vedi voce "Notifica utente quando admin cancella la sua prenotazione" sotto). Senza notifica, la cancellazione retroattiva è ostile.

3. **Mantengo lo storico?** Le prenotazioni cancellate da admin via Closure dovrebbero essere `status=CANCELLED` con un campo nuovo `cancelledByClosureId` per audit ("perché è stata cancellata: blocco X").

4. **UX al momento del blocco**: il dialog "Aggiungi chiusura" potrebbe mostrare un preview "N prenotazioni esistenti per i giorni selezionati" + 3 opzioni:
   - Lascia attive (default attuale)
   - Cancella ora e notifica gli utenti via email/in-app
   - Cancella ora silenzio (per casi di chiusure manifeste tipo Natale)

Decisione operativa: lasciare il behavior attuale (cancel manuale) finché:
   - Non c'è canale di notifica aziendale (Q1 + scelta tecnica)
   - Non si raccolgono casi reali in cui la cancel manuale dà fastidio HR

Quando si attiva: schema migration + estensione `Closure.create` con opt `cancelExistingReservations: boolean` + nuovo campo `Reservation.cancelledByClosureId`.

- **Priority**: 🟡 MED (utile in HR, ma fragile senza notifiche)
- **Stato**: ⏳ DA ANALIZZARE — aspetta canale notifiche aziendale

##### C2 — Posti riservati a categorie (manager, stagisti, etc.)

Decisione presa: **strada (a)** = prenotazioni "pre-caricate" da HR per conto degli interessati. Riusa il pattern di prenotazione per altri (admin POST), niente schema cambiato. Trade-off accettato: sposta lavoro su HR vs automazione.

L'implementazione manuale uno-per-uno è proibitiva (5 stagisti × ~100 giorni lavorativi = 500 click) → C3 è il prerequisito UX.

##### C3 — Operazioni bulk (precarico massivo prenotazioni HR) — ✅ implementato (vedi `CHANGELOG.md`)

Caso d'uso: HR precarica prenotazioni per N stagisti × M giorni in onboarding. Uno-per-uno è inaccettabile.

**Decisione 1 — mappatura utente → spot**

| Modalità | Quando usarla |
|---|---|
| **B. Mappatura esplicita 1:1** (default) | HR sa già "Mario → P-15, Luigi → P-16". UX: tabella editor utente×spot, una riga per utente |
| **C. Auto-assign da pool** (toggle "auto") | Pool grande, basta che ogni utente ne abbia uno qualunque. UX: scegli `siteId+spotType`, il backend assegna il primo libero per ogni (utente, data) |

**A. Stesso spot per tutti scartato**: 5 stagisti **non possono** condividere lo stesso parking → A è inutile.

**Decisione 2 — strategia su giorni problematici: "skip & report"**

Per ogni `(user, date)` la create può fallire per:
- Closure attiva (festività, manutenzione)
- L'utente ha già una prenotazione attiva di quel tipo
- Spot già preso (in B), pool esaurito (in C)
- Weekend (se HR vuole skiparli)

Backend genera tutte le combinazioni, prova ad inserire ognuna, raccoglie successi e fallimenti, ritorna:

```json
{
  "created": 487,
  "skipped": [
    {"userId": "u1", "date": "2026-07-15", "reason": "giorno bloccato (festività)"},
    {"userId": "u2", "date": "2026-08-10", "reason": "ha già una prenotazione di tipo PARKING"}
  ]
}
```

HR vede il report in un modal post-submit, può copiarlo. **Niente transazione "tutto-o-niente"**: meglio "creo quello che posso + ti dico cosa è andato storto" che far fallire 500 inserimenti perché 1 collide.

**Decisione 3 — UI: modal wizard integrato in `/admin/reservations`**

Cambiata rispetto al design iniziale (pagina dedicata `/admin/bulk-bookings`): la pagina admin/reservations è già il punto naturale per gestire prenotazioni, integrare il bulk lì riduce il menu admin a 2 voci (Prenotazioni + Chiusure) e mantiene l'admin in un singolo posto. La preview tabellare di 500 righe sarebbe utile in pagina dedicata ma in pratica HR si fida del count "5×100=500" e legge solo il **report post-submit** (le `skipped`, di solito 10-30 righe — entrano comodamente in un modal).

Bottone "Prenotazione massiva…" accanto a "Prenota per utente…" sopra la tabella. Apre Modal Carbon `size="lg"` con wizard a step:

1. **Utenti** (FilterableMultiSelect)
2. **Range date** Da/A + checkbox giorni della settimana (lun-ven default)
3. **Mappatura spot**: tabella editor 1:1 (B, default) oppure toggle "auto-assign" + select siteId+spotType (C)
4. **Submit + report**: riepilogo testuale ("5 utenti × 100 giorni = 500, ~12 saltate per chiusure festive"), bottone "Crea prenotazioni" → backend → response `{created, skipped: [{userId, date, reason}]}` → tabella skipped nel modal.

State perso al chiudere il modal → confirm dialog "Hai modifiche non salvate, chiudere comunque?".

**Endpoint**: `POST /admin/reservations/bulk` body con `userIds`, `from`, `to`, `weekdays: number[]` (0=Sun … 6=Sat, formato `Date.getDay()`), `mappingMode: "explicit"|"pool"`, `spotMapping?: Record<userId, spotId>`, `spotPool?: {siteId, spotType}`. Response `{created: N, skipped: [{userId, date, reason}]}`. Riusa la logica di `ReservationsService.create` (inclusi check Closure aggiunti in C1) con `unrestrictedDate: true` (HR può caricare nel passato e oltre MAX_DAYS_AHEAD). Cap a 5000 inserimenti per call (10 utenti × 365 giorni).

**Stima**: 2-3 giornate. File toccati: shared schema, `ReservationsService.bulkCreate`, `AdminReservationsController` (nuovo `@Post("bulk")`), nuovo `BulkBookingsDialog` component, bottone in `AdminReservationsList`.

- **Priority**: ✅ FATTO
- **Stato**: ✅ IMPLEMENTATO (vedi CHANGELOG)

##### C4 — Cancellazione massiva in `/admin/reservations` (DA FARE)

Pattern simmetrico al bulk-delete già fatto in `/admin/closures`. In `/admin/reservations` vista Lista:
- Backend: nuovo `POST /admin/reservations/bulk-cancel` body `{ids: string[]}` → `prisma.reservation.updateMany({where: {id: {in}}, data: {status: "CANCELLED"}})`. Idempotente, ritorna `{cancelled: N}`. Solo righe ACTIVE vengono toccate (le già-CANCELLED restano).
- Frontend: `TableSelectAll` + `TableSelectRow` (selezione disabilitata sulle righe CANCELLED — niente azione utile), bottone "Cancella selezionate (N)" `kind="danger--tertiary"` visibile con N>0, modal di conferma plurale. Selezione resettata al cambio filtri / reloadTick.
- Stima: ~1 giornata.

- **Priority**: 🟢 utile per pulizia di prenotazioni errate / fine onboarding
- **Stato**: 🔴 TODO

##### C5 — Audit `createdBy` / `cancelledBy` su Reservation (DA FARE)

Tracciare CHI ha fatto cosa su una prenotazione (oggi non sappiamo se una prenotazione l'ha creata l'utente, un admin "per conto di", o un bulk; né chi l'ha cancellata).

Schema:
```prisma
model Reservation {
  ...
  createdByUserId   String?  // null = legacy; valorizzato d'ora in poi
  cancelledByUserId String?  // valorizzato solo quando status=CANCELLED
}
```

Logica di popolamento:
- `create()` self-service → `createdByUserId = userId`.
- `adminCreate` (Prenota per utente) + `bulkCreate` → `createdByUserId = admin.id`.
- `cancel()` self-service → `cancelledByUserId = userId`.
- `cancel()` admin → `cancelledByUserId = admin.id` (oggi il param `userId` di cancel è già l'admin chiamante quando `isAdmin`).
- `adminUpdate` (transfer): `createdByUserId` invariato (è cambio intestatario, non nuova creazione); valutare un campo storico a parte se serve audit del transfer.

UI: 2 colonne sortable "Creata da" / "Cancellata da" in `/admin/reservations` (displayName o "—"/"Sistema" per legacy NULL).

Migration: 2 colonne nullable + eventuali indici se filtreremo per autore. Niente backfill (legacy → NULL → "—").

- **Priority**: 🟡 MED (compliance/tracciabilità, utile prima del go-live aziendale)
- **Stato**: 🔴 TODO

#### Azioni admin (next step concreti, su `/admin/reservations`)

- ✅ **Prenota per conto di un utente** (vedi `CHANGELOG.md` 2026-06-20).
- ✅ **Cancella prenotazione di un utente** (vedi `CHANGELOG.md` 2026-06-20).
- ✅ **Trasferisci prenotazione (cambio intestatario)** (vedi `CHANGELOG.md` 2026-06-20): atomico via `PATCH /admin/reservations/:id`, riuso dello stesso modale di cancel.
- ✅ **Override vincoli temporali per admin**: l'admin può prenotare per date nel passato (inserimento storico HR) e oltre `MAX_DAYS_AHEAD`. Implementato via opt `unrestrictedDate` su `SpotsService.list` e `ReservationsService.create` (vedi CHANGELOG 2026-06-20).
- ✅ **Blocca giorno (Chiusure)** (parte di C, vedi `CHANGELOG.md` 2026-06-20).
- ✅ **Bulk pre-carico HR** (parte di C, vedi `CHANGELOG.md`): modal wizard in `/admin/reservations`.
- **Cancellazione massiva** (vedi sezione **C4**: bulk-cancel righe selezionate in /admin/reservations).
- **Audit createdBy/cancelledBy** (vedi sezione **C5**).
- **Cancellazione retroattiva al blocco** (vedi sezione **C1.1**: aspetta canale notifiche aziendale).
- **Sezione config** parametri DB-level (parte di C, decisione Q3 dice "non ora — env").
- **Export** CSV / Excel — fase 2, dopo che la pagina vede uso reale.
- **Notifica utente** quando admin cancella la sua prenotazione: email / in-app. Per ora avviso esplicito nel modal admin "L'utente non riceve notifica". Da rivedere quando l'azienda definirà il canale di notifiche aziendale.

---

### Domande ancora aperte

#### Q1. Provenienza dei ruoli e dei riporti da Entra ID

In produzione l'auth sarà Entra ID. Domande aperte:
- Il ruolo `MANAGER` / `HR` arriva come **claim** di Entra (group membership / app role assignment) o lo manteniamo lato app?
- I **diretti riporti** sono interrogabili via Microsoft Graph (`/me/directReports`)? Disponibile per tutti gli utenti del tenant o solo con permessi specifici?
- HR vuole amministrare i ruoli da Entra (gruppi/app roles) o preferisce gestione interna all'app?

**Proposta operativa**: prima di aggiungere `User.managerId`, tabella `Team` o gruppi ad hoc, fare una **spike di 1-2 giorni** con un account Entra di test (anche personale) per verificare empiricamente cosa è interrogabile e cosa no. Output dello spike: documento di 2-3 pagine con payload claim, risposte Graph, vincoli scoperti.

Senza spike si rischia di costruire un modello dati che poi scopriamo essere ridondante o non sincronizzabile con Entra.

- **Priority**: 🟡 MED (non urgente fino al go-live aziendale, ma blocca le feature MANAGER e qualunque cosa dipenda dai riporti)
- **Stato**: ⏳ IN ATTESA DI SPIKE