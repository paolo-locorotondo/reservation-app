# TODO

Backlog dei prossimi step, in ordine di priorità da discutere. Voci completate nello storico in [CHANGELOG.md](./CHANGELOG.md).

## Revoca privilegi già loggati (sicurezza)

Oggi `token.role` è "frozen" al login: calcolato da `computeRole` nel callback `jwt` di NextAuth solo quando `account && profile` sono presenti (una volta, dopo l'OAuth). Le sorgenti sono `ADMIN_EMAILS`, `MANAGER_EMAILS` e il claim `ibmEdIsManager`. Conseguenze:

- Rimuovere un'email da `ADMIN_EMAILS`/`MANAGER_EMAILS` (o un cambio del claim) **non** declassa un utente già loggato: il JWT in tasca resta col vecchio ruolo per tutta la session (default NextAuth: 30gg), finché non fa logout o la session scade.
- Simmetrico: aggiungere un'email non promuove finché l'utente non rifà login.
- NB: `User.role`/`User.managerEmail` a DB sono solo una copia scritta al login — il runtime (middleware, proxy, RolesGuard) usa il **token**, non il DB. Editare il DB non ha effetto senza re-login.

**Decisione presa (2026-06-23)**:
- **(a) Riduzione `maxAge` JWT** (es. 8-12h) → mitigazione scelta, **da applicare al go-live** (non ora: in MVP `ADMIN_EMAILS`/`MANAGER_EMAILS` cambiano di rado e non c'è dato sensibile). Economica, zero query extra; la "blast radius" di un ruolo stantio si limita alla giornata lavorativa.
- **(b) DB come source-of-truth a runtime** (rilettura `User.role` nel `jwt` ad ogni richiesta) → **rimandata** a quando esisterà una UI admin di gestione ruoli: solo allora la query-per-request (mitigabile con throttle a timestamp) si giustifica e il DB-come-verità ha senso.
- (c) token short-lived + refresh → scartata per ora (troppa infrastruttura).

- **Priority**: 🟡 MED (applicare (a) al go-live; irrilevante in MVP)
- **Stato**: ⏳ DECISO — (a) maxAge da applicare al go-live

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
| `MANAGER` (ruolo assegnato al login, pagine da fare — vedi B1) | Sé + i propri riporti | Sé + i propri riporti | Sé + i propri riporti |
| `ADMIN` / `HR` (oggi promosso da ADMIN_EMAILS) | Tutti | Tutti | Tutti |

Tre dimensioni indipendenti che ne discendono (stato per ruolo):
- **Visibilità**: ✅ ADMIN su `/admin/reservations`. Da estendere a MANAGER con scoping riporti.
- **Prenotazione per altri**: ✅ ADMIN via `POST /admin/reservations` (vedi CHANGELOG 2026-06-20). Da estendere a MANAGER con scoping riporti.
- **Cancellazione di altri**: ✅ ADMIN via `DELETE /admin/reservations/:id` con flag `isAdmin` nel service. Da estendere a MANAGER con scoping riporti.

##### B1 — Pagine scoped per MANAGER — ✅ IMPLEMENTATO (vedi `CHANGELOG.md`)

**Realizzato** (scelte: pagine/componenti **duplicati** in `/manager/*`, **niente** closures per manager, scope = riporti diretti + sé):
- Backend: endpoint `/manager/reservations` (list/create/bulk/bulk-cancel/patch/delete), `/manager/users`, `/manager/spots` — `@Roles(MANAGER)` + `ManagerScopeService` che risolve `{self} ∪ {User WHERE managerEmail = manager.email}`. Lo scope è threadato nel `ReservationsService` condiviso (param `scopeUserIds`/`allowedUserIds`), non duplicato.
- Frontend: componenti duplicati `ManagerReservationsList` / `ManagerBookForUserDialog` / `ManagerBulkBookingsDialog` / `ManagerReservationsCalendar`; pagina `/manager/reservations`; nav "Il mio team" (solo MANAGER); middleware gate `/manager/*` = MANAGER.
- Chiusure: overlay calendar via `GET /closures` user-level (no endpoint manager).

**Restano aperti** (da valutare): gerarchia multi-livello (riporti dei riporti — oggi solo diretti); se il MANAGER debba avere `unrestrictedDate` come ora (parità admin) o vincoli temporali; uso di `ibmEdHrActive` per filtrare riporti non attivi.

<details><summary>Progettazione originale (storica)</summary>

**Stato infrastruttura (fatto)**: ruolo `MANAGER` esiste nell'enum e viene assegnato al login (`ibmEdIsManager==="Y"`); `User.managerEmail` popolato dai claim. Manca tutto il lato "cosa può fare un MANAGER" — oggi le pagine `/admin/*` sono ADMIN-only (middleware + `RolesGuard`), quindi un MANAGER fa login, ottiene il ruolo, ma non ha ancora pagine dedicate.

**Modello di scoping**: i riporti diretti di un manager M = `User WHERE managerEmail = M.email`. Un MANAGER può vedere/gestire le prenotazioni **proprie + dei suoi riporti diretti** (per ora solo diretti; gerarchia multi-livello = fase successiva).

**Proposta UI — riuso di `/admin/reservations`, NON una pagina nuova**:
- Stessa pagina e componenti (`AdminReservationsList`, calendar, bulk, prenota/cancella per utente), ma il backend **filtra automaticamente** il dataset agli id dei riporti + sé stesso quando il chiamante è MANAGER (non ADMIN).
- Il filtro "Utenti" del MANAGER è precaricato/limitato ai soli riporti (non tutti gli utenti come per ADMIN).
- Nessuna voce di menu nuova: "Amministrazione" diventa visibile anche ai MANAGER (oggi `adminOnly` la mostra solo ad ADMIN → diventerà `minRole` o simile). Label eventualmente diversa ("Il mio team" per MANAGER vs "Amministrazione" per ADMIN).

**Backend — scoping (punto critico)**: la scelta architetturale è *dove* applicare il filtro riporti.
- Opzione (a) — **stesso endpoint, scoping nel service**: `listAdmin`/`create`/`cancel`/`bulk` ricevono il chiamante (già disponibile via token) e, se `role===MANAGER`, restringono a `managerEmail = caller.email`. Pro: un solo set di endpoint. Contro: ogni endpoint admin deve ricordarsi il check (rischio dimenticanza → leak).
- Opzione (b) — **endpoint separati `/manager/*`**: nuovi controller con un `ManagerScopeGuard` che inietta il set di userId ammessi. Pro: separazione netta, il guard centralizza il check. Contro: duplicazione endpoint.
- Raccomandazione: **(a) con un helper condiviso** `assertCanActOn(caller, targetUserId)` + un `scopeFilter(caller)` che ritorna il `where` sugli userId — usato da tutti gli endpoint admin. Il `RolesGuard` passa da `@Roles(ADMIN)` a `@Roles(ADMIN, MANAGER)` sugli endpoint condivisi, e lo scoping fine è nel service.

**Regole di permesso MANAGER** (da far rispettare nel service):
- Vede prenotazioni dove `reservation.userId ∈ {self} ∪ {riporti}`.
- Prenota/cancella/trasferisce solo per utenti in quell'insieme (il transfer verso un non-riporto è vietato).
- Bulk: `userIds` ristretto ai riporti.
- Le Chiusure (`/admin/closures`) restano ADMIN-only (decisione di sede, non di team) — da confermare.

**Aperte / da decidere**:
- Gerarchia multi-livello (riporti dei riporti)? Per ora **no**, solo diretti.
- Un MANAGER può prenotare per sé nel passato/oltre MAX_DAYS_AHEAD come ADMIN, o resta vincolato come USER? Proposta: vincolato come USER per le proprie, sblocco solo per i riporti? Da decidere.
- `ibmEdHrActive`: filtrare i riporti non più attivi? (dipende dal significato del campo, da chiarire con HR).

</details>

- **Priority**: ✅ FATTO (restano le rifiniture "aperti" sopra)
- **Stato**: ✅ IMPLEMENTATO (vedi CHANGELOG)

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

##### C4 — Cancellazione massiva in `/admin/reservations` — ✅ implementato (vedi `CHANGELOG.md`)

Pattern simmetrico al bulk-delete di `/admin/closures`. `POST /admin/reservations/bulk-cancel` body `{ids}` → `updateMany` su `status: ACTIVE` → CANCELLED + `cancelledByUserId`. UI: `TableSelectAll`/`TableSelectRow` (solo righe ACTIVE), bottone "Cancella selezionate (N)" `danger--tertiary`, modal conferma.

- **Priority**: ✅ FATTO
- **Stato**: ✅ IMPLEMENTATO (vedi CHANGELOG)

##### C5 — Audit `createdBy` / `cancelledBy` su Reservation — ✅ implementato (vedi `CHANGELOG.md`)

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

- **Priority**: ✅ FATTO
- **Stato**: ✅ IMPLEMENTATO (vedi CHANGELOG)

##### C6 — Paginazione tabelle admin (DA FARE)

Le tabelle di `/admin/reservations` (vista Lista) e `/admin/closures` rendono tutte le righe del dataset (fino al `*_LIST_LIMIT`). Con molte righe la pagina web diventa lunghissima e poco navigabile — serve paginazione.

Opzioni:
- **(a) Paginazione client-side** (più semplice): le righe sono già tutte caricate (cap a `ADMIN_RESERVATIONS_LIST_LIMIT`=500). Aggiungere `Pagination` di Carbon che fa lo slice client del dataset già in memoria (es. 25/50/100 righe per pagina). Zero modifiche backend. Limite: non scala oltre il LIST_LIMIT, ma quello è già il tetto attuale.
- **(b) Paginazione server-side** (scala davvero): `page`/`pageSize` nella query, `skip`/`take` Prisma, response con `total`. Rimuove di fatto il `truncated`/LIST_LIMIT. Più lavoro (query + count + sync con sort/filtri che oggi sono client-side per il sort).

Raccomandazione: **(a) come primo step** — risolve il problema UX immediato (pagina troppo lunga) riusando i dati già in memoria, con `Pagination` Carbon. Valutare (b) solo se il dataset reale supera regolarmente i 500.

Da applicare a:
- `/admin/reservations` vista Lista ([`AdminReservationsList.tsx`](apps/web/src/components/AdminReservationsList.tsx))
- `/admin/closures` ([`AdminClosuresList.tsx`](apps/web/src/components/AdminClosuresList.tsx))

Nota: il sort è client-side su tutto il dataset (giusto, deve precedere lo slice di pagina); la selezione multi-row (bulk-cancel/bulk-delete) deve restare coerente attraverso i cambi pagina (lo state `selectedIds` è un Set di id, quindi sopravvive al cambio pagina — verificare che "seleziona tutto" agisca sulla pagina corrente o sull'intero dataset, scelta UX da fare).

- **Priority**: 🟡 MED (UX, peggiora con la crescita dei dati)
- **Stato**: 🔴 TODO

#### Azioni admin (next step concreti, su `/admin/reservations`)

- ✅ **Prenota per conto di un utente** (vedi `CHANGELOG.md` 2026-06-20).
- ✅ **Cancella prenotazione di un utente** (vedi `CHANGELOG.md` 2026-06-20).
- ✅ **Trasferisci prenotazione (cambio intestatario)** (vedi `CHANGELOG.md` 2026-06-20): atomico via `PATCH /admin/reservations/:id`, riuso dello stesso modale di cancel.
- ✅ **Override vincoli temporali per admin**: l'admin può prenotare per date nel passato (inserimento storico HR) e oltre `MAX_DAYS_AHEAD`. Implementato via opt `unrestrictedDate` su `SpotsService.list` e `ReservationsService.create` (vedi CHANGELOG 2026-06-20).
- ✅ **Blocca giorno (Chiusure)** (parte di C, vedi `CHANGELOG.md` 2026-06-20).
- ✅ **Bulk pre-carico HR** (parte di C, vedi `CHANGELOG.md`): modal wizard in `/admin/reservations`.
- ✅ **Cancellazione massiva** (parte di C, vedi `CHANGELOG.md`): bulk-cancel righe selezionate in /admin/reservations.
- ✅ **Audit createdBy/cancelledBy** (vedi `CHANGELOG.md`): colonne "Creata da"/"Cancellata da".
- **Paginazione tabelle admin** (vedi sezione **C6**: /admin/reservations + /admin/closures).
- **Cancellazione retroattiva al blocco** (vedi sezione **C1.1**: aspetta canale notifiche aziendale).
- **Sezione config** parametri DB-level (parte di C, decisione Q3 dice "non ora — env").
- **Export** CSV / Excel — fase 2, dopo che la pagina vede uso reale.
- **Notifica utente** quando admin cancella la sua prenotazione: email / in-app. Per ora avviso esplicito nel modal admin "L'utente non riceve notifica". Da rivedere quando l'azienda definirà il canale di notifiche aziendale.

---

### Domande ancora aperte

#### Q1. Provenienza dei ruoli e dei riporti — ✅ SPIKE FATTO (w3id OIDC)

Spike eseguito con provider **w3id OIDC** (`https://preprod.login.w3.ibm.com`, configurato in SSO Provisioner; vedi `lib/auth.ts` provider `ibmsso`). NB: l'auth IBM è **w3id**, non Entra diretto come ipotizzato inizialmente — le risposte sotto si basano sui claim reali osservati.

##### Claim disponibili (osservati nel id_token + userinfo)

Mapping attributi configurati in SSO Provisioner (sorgente → target):
- `email → sub` / `email → emailAddress`
- `employee_id → uid`
- `encodedName → cn`, `encodedConsolidatedFirstName → firstName`, `encodedConsolidatedLastName → lastName`
- `ibmEdDN → dn`
- `encodedGroupWithoutDN → blueGroups` (BlueGroups, **valori encoded/criptici** — non nomi leggibili)
- `w3idRealmName → realmName`

Campi aggiuntivi abilitati durante lo spike (tutti nei claim):
- `ibmEdEmployeeType` (es. `"P"` = Practitioner)
- `ibmEdHrActive` (es. `"A"`)
- `ibmEdIsManager` (`"Y"`/`"N"`)
- **`managerEmail`** (email del manager — chiave per ricostruire la gerarchia)
- `ibmEdJobResponsibilities` (es. "Senior Practitioner - Application Developer: ...")

##### Risposte alle domande

1. **Il ruolo arriva come claim?** → SÌ, due possibili sorgenti:
   - `blueGroups` (BlueGroups encoded): approccio IBM-nativo, ma i valori sono codici criptici da mappare per prova (creare un gruppo dedicato, vedere quale codice compare).
   - `ibmEdIsManager` / `ibmEdEmployeeType`: discriminanti diretti già leggibili.
2. **Riporti diretti interrogabili?** → NON direttamente via OIDC (niente claim `directReports`). MA c'è **`managerEmail`**: si può ricostruire l'albero "dal basso" — ogni utente conosce il proprio manager, quindi i riporti di X = tutti gli utenti con `managerEmail = X.email`. Richiede che gli utenti abbiano fatto login almeno una volta (per popolare il campo a DB).
3. **HR amministra i ruoli da w3id?** → i BlueGroups sono gestibili da HR/owner senza redeploy; `ibmEd*` sono read-only dal sistema HR IBM.

##### Decisioni di design (DA CONFERMARE dopo verifica con manager + HR)

Per la verifica: i claim sono ora **mostrati temporaneamente nel menu account** (`AppShell`, marcati `[SPIKE Q1]`) — far loggare manager/HR e confrontare i valori.

**✅ Verifica manager (2026-06-23)**: confermato che `ibmEdIsManager` discrimina correttamente — `"Y"` per il manager, `"N"` per il suo riporto diretto. Quindi `ibmEdIsManager` è una sorgente affidabile per il ruolo MANAGER.

- **Modello ruoli — DECISO e IMPLEMENTATO** (vedi `CHANGELOG.md` 2026-06-23):
  - **ADMIN** → email in `ADMIN_EMAILS` (deciso: si **mantiene** questo meccanismo, niente BlueGroup).
  - **MANAGER** → `ibmEdIsManager === "Y"` (confermato empiricamente).
  - **USER** → default.
  - Scartati: `ibmEdEmployeeType` (non necessario) e BlueGroup per ADMIN (encoded, più complesso del beneficio).
- **Gerarchia riporti — IMPLEMENTATO**: `User.managerEmail` popolato al login dai claim. Riporti diretti di un manager = `User WHERE managerEmail = :email`. Niente Microsoft Graph / BluePages.
- **Ancora da verificare con HR** (unico punto aperto): significato di `ibmEdHrActive` (`"A"`=?) e se serve per filtrare utenti non più attivi.

##### Prossimi step

1. ✅ Verifica claim con manager (login: `ibmEdIsManager` Y/N confermato).
2. ✅ `User.managerEmail` (migration) + popolamento in provisioning/proxy al login.
3. ✅ Ruolo da claim: `computeRole` ADMIN(`ADMIN_EMAILS`) > MANAGER(`ibmEdIsManager`) > USER. **`ADMIN_EMAILS` mantenuto** (non sostituito).
4. ✅ Enum `Role` esteso con `MANAGER`. ⏳ Scoping riporti + pagine MANAGER: vedi sezione **(B) → B1** (progettato, da implementare).
5. ✅ Rimossi i `console.log [SPIKE-Q1]`. Box claim w3id nel menu account **mantenuto** volutamente (ispezione manager/HR) + campi `w3id` in session.
6. ⏳ Chiarire `ibmEdHrActive` con HR.

- **Priority**: 🟡 MED — infrastruttura ruoli FATTA; resta la feature MANAGER (pagine scoped, B1)
- **Stato**: ✅ SPIKE FATTO + RUOLI IMPLEMENTATI — aperti solo `ibmEdHrActive` (HR) e le pagine MANAGER (B1)