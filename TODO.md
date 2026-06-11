# TODO

Backlog dei prossimi step, in ordine di priorità da discutere. Voci completate nello storico in [CHANGELOG.md](./CHANGELOG.md).

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

## Concorrenza prenotazioni — verifica e hardening

Verifica fatta sul codice attuale (`apps/api/src/reservations/reservations.service.ts`):

- ✅ **Due utenti sullo stesso spot/giorno**: protetta dal vincolo DB `@@unique([spotId, date, status])`. Il secondo `INSERT` solleva Prisma P2002 → mappato a `ConflictException` ("posto già prenotato per questa data"). Race-safe.
- ⚠️ **Stesso utente, doppio submit ravvicinato (es. due click rapidi su mobile)**: il check "hai già un posto auto/scrivania per questa data" è `findFirst` seguito da `create`, NON transazionale. Due richieste in volo potrebbero entrambe vedere `existing === null` e creare due ACTIVE dello stesso tipo per lo stesso utente/giorno. Mitigazioni possibili:
  1. Aggiungere un vincolo DB tipo `@@unique([userId, date, spotType, status])` — richiede però di denormalizzare `spotType` su `Reservation` (oggi sta solo su `Spot`).
  2. Avvolgere check + create in `prisma.$transaction` con isolation `Serializable`.
  3. Lato FE: disabilitare il bottone "Conferma" in `BookingDialog` durante l'inflight (probabilmente già fatto, da verificare).

### Note dalla verifica (2026-05-25)

- ✅ **FE inflight già coperto**: `BookingDialog.tsx` disabilita il bottone Prenota tramite `primaryButtonDisabled={submitting}` e blocca anche `onRequestClose` mentre `submitting` è true. Nessun intervento necessario sul punto 3.
- 🔍 **Pattern già in uso nel progetto**: lo unique "una sola ACTIVE per spot/giorno" NON è un `@@unique` Prisma ma un **partial unique index SQL** (`CREATE UNIQUE INDEX ... ON "Reservation"("spotId","date") WHERE status='ACTIVE'`, vedi commento in `schema.prisma`). Motivo: un `@@unique` pieno su `(spotId,date,status)` impedirebbe più CANCELLED storiche per lo stesso spot/giorno. Lo stesso pattern è applicabile per il caso utente.
- 💡 **Approccio consigliato quando si farà il fix**: opzione 1 — denormalizzare `spotType` su `Reservation` (campo stabile, un posto non cambia tipo) + partial unique `WHERE status='ACTIVE'` su `(userId, date, spotType)`. Coerente con l'altro partial index, garanzia DB-level che sopravvive a bug applicativi. Richiede migration con backfill da `Spot.type`. Il check `findFirst` esistente resta come validazione "soft" per dare messaggi italiani user-friendly senza far partire una INSERT destinata a fallire.
- ❌ **Scartata opzione 2** (transazione `Serializable`): eviterebbe la denormalizzazione ma introduce gestione di `40001 serialization_failure` con retry — più codice, meno robusto.
- **Priority**: 🟡 MED (probabilità bassa in pratica, ma è la classe di bug peggiore — silente)
- **Stato**: 🟡 VERIFICATO — fix non implementato (da fare quando si valuta priorità)

## Analisi: ruoli, permessi e regole di business

Sezione di **analisi** (non ancora progettazione). Raccoglie tutto ciò che ruota attorno a "chi può fare cosa, e quali parametri sono regolabili senza redeploy". Confluiscono qui due cose che prima erano separate: la pagina Admin/HR (chi vede le prenotazioni altrui) e la gestione delle regole configurabili (festività, posti riservati, parametri).

Tre piani da non confondere:

- **(A) Validazioni "tecniche"**: vincoli di integrità (formati, range, unicità) che valgono per qualunque utente e che non vogliamo rendere configurabili.
- **(B) Permessi per ruolo**: chi può vedere/modificare le prenotazioni di chi.
- **(C) Eccezioni dinamiche**: dati gestibili da Admin/HR senza redeploy (festività, posti riservati, parametri come `MAX_DAYS_AHEAD`).

---

### Stato attuale (snapshot delle regole già in vigore)

Sono prevalentemente di tipo (A). Solo le 5 e 7 toccano (B) in modo binario `USER` / `ADMIN`.

1. **Range temporale di prenotazione**. Una `date` di prenotazione deve essere `>= oggi` e `<= oggi + MAX_DAYS_AHEAD` (UTC). Default 30 giorni, configurabile via env (`MAX_DAYS_AHEAD` per l'API + `NEXT_PUBLIC_MAX_DAYS_AHEAD` build-time per il frontend). Validato in `parseDateUtc` di [`spots.service.ts`](apps/api/src/spots/spots.service.ts) e [`reservations.service.ts`](apps/api/src/reservations/reservations.service.ts).
2. **Quota personale per tipo, per giorno**. Un utente può avere al massimo **1 prenotazione ACTIVE per ciascun `spotType`** nello stesso giorno: quindi 1 posto auto + 1 scrivania al massimo nello stesso giorno. Check in `ReservationsService.create()` via `findFirst` su `(userId, date, status='ACTIVE', spot.type)`. NB: protezione "soft" (race possibile su doppio submit ravvicinato — vedi "Concorrenza prenotazioni").
3. **Esclusività spot/giorno**. Per un dato `spotId` e `date` può esistere al massimo **1 prenotazione `ACTIVE`**. Garanzia DB-level via partial unique index SQL `WHERE status='ACTIVE'` (vedi commento in `schema.prisma`). Race-safe: P2002 → `ConflictException`.
4. **Spot deve essere `active=true`**. Solo gli spot con `active=true` sono prenotabili. Quelli `active=false` filtrati a monte da `SpotsService.list()` e `availability()`. Difesa ulteriore in `create()` che rifiuta con `ConflictException("posto non attivo")`.
5. **Cancellazione solo del proprio**. Solo il proprietario può cancellare la propria prenotazione. `cancel()` ritorna `NotFoundException` (404 deliberato per non leakare l'esistenza dell'ID). Nessun ruolo, nemmeno `ADMIN`, può cancellare prenotazioni altrui.
6. **Cancellazione idempotente**. `cancel()` su una prenotazione già `CANCELLED` ritorna lo stato senza scrivere su DB. Difesa contro doppi click / refresh.
7. **Auto-provisioning utente al primo login**. Google OAuth crea il record `User` se non esiste, ruolo `USER` di default. Promosso a `ADMIN` se l'email è in `ADMIN_EMAILS` (env, CSV).
8. **Tipi posto fissi**. Solo `PARKING` e `DESK`. Aggiungerne uno = migration + UI.
9. **Stati prenotazione fissi**. `ACTIVE` o `CANCELLED`. Non ci sono stati intermedi (`PENDING`, `CHECKED_IN`, ecc.).
10. **Granularità giornaliera**. `Reservation.date` è `@db.Date`: si prenota un intero giorno civile, non fasce orarie.
11. **Formato date API**. Tutti gli endpoint date richiedono `YYYY-MM-DD` (Zod regex). Stringhe non conformi → 400.

---

### Direzione futura

#### (B) Permessi per ruolo

Mappatura ruoli evolvere da binaria a tre livelli:

| Ruolo | Vede | Può prenotare per | Può cancellare per |
|---|---|---|---|
| `USER` (oggi default) | Sé | Sé | Sé |
| `MANAGER` (nuovo) | Sé + i propri riporti | Sé + i propri riporti | Sé + i propri riporti |
| `ADMIN` / `HR` (oggi promosso da ADMIN_EMAILS) | Tutti | Tutti | Tutti |

Tre dimensioni indipendenti che ne discendono — quando si progetterà andranno mappate una alla volta:
- **Visibilità**: estendere `GET /reservations` (scoping per ruolo) + nuova pagina dedicata Admin/HR / Manager.
- **Prenotazione per altri**: estendere `POST /reservations` con `userId` opzionale (controllato dal RolesGuard).
- **Cancellazione di altri**: rilassare il check `r.userId !== userId` quando il chiamante è MANAGER (sui riporti) o ADMIN (su tutti).

#### (C) Eccezioni e parametri dinamici

Cose che oggi non esistono ma che, per natura, l'amministratore vuole modificare senza redeploy:

- **Giorni bloccati** (festività, chiusure di sede). Per-sede oppure aziendali. Modello: nuova entità `Closure` (o `BlockedDate`) con `(date, siteId?)`. Si rifiuta la prenotazione se la coppia matcha. Vista calendario: pallino grigio "bloccato".
- **Posti riservati a categorie** (manager, stagisti). Due strade: (a) prenotazioni "pre-caricate" da HR per conto degli interessati (riusa il pattern di prenotazione per altri); (b) annotare `Spot` con un flag/lista di ruoli ammessi (`reservedFor: Role[]`). La (a) è meno invasiva ma sposta l'onere su HR; la (b) è più automatica ma richiede schema più ricco e logica di filtro.
- **Parametri configurabili** (oggi `MAX_DAYS_AHEAD`, in futuro altri). Da spostare da env a tabella DB se vogliamo console di amministrazione. Trade-off: env = redeploy ad ogni cambio, semplice; DB = console UI, refresh runtime, più infrastruttura. Decisione dipende da quanto spesso i parametri cambiano nella realtà.

#### Pagina Admin / HR / Manager (deriva da B + C)

Una pagina riservata che combina:
- **Tabella prenotazioni** filtrabile (intervallo date, sede, piano, tipo, utente search, stato). Colonne: Data, Utente, Tipo, Codice posto, Sede, Piano, Zona, Stato, Creata il, Cancellata il (`updatedAt` per i CANCELLED).
- **Azione cancel** per riga (se permesso dal ruolo).
- **Azione "prenota per …"** (se permesso dal ruolo).
- **Sezione config** (eccezioni e parametri di C).
- **Export** CSV / Excel — verosimilmente in fase 2, dopo che la pagina vede uso reale.

Routing ipotizzato: `/admin` con sottosezioni `/admin/reservations`, `/admin/closures`, `/admin/settings`. Voce nav visibile solo se `me.role !== "USER"`.

---

### Domande aperte (bloccanti per la progettazione)

Sono le risposte da raccogliere **prima** di toccare schema o codice. Senza queste, qualunque scelta sarebbe da rifare.

#### Q1. Provenienza dei ruoli e dei riporti da Entra ID

In produzione l'auth sarà Entra ID. Domande:
- Il ruolo `MANAGER` / `HR` arriva come **claim** di Entra (group membership / app role assignment) o lo manteniamo lato app?
- I **diretti riporti** sono interrogabili via Microsoft Graph (`/me/directReports`)? È disponibile per tutti gli utenti del tenant o solo per chi ha permessi specifici?
- HR vuole davvero amministrare i ruoli da Entra (gruppi/app roles), o preferisce una gestione interna all'app (tabella `User.role`)?

**Proposta operativa**: prima di aggiungere `User.managerId`, gruppi, ruoli o tabelle ad hoc, fare una **spike di 1-2 giorni** con un account Entra di test (anche personale, se possibile) per verificare empiricamente cosa è interrogabile e cosa no. Output dello spike: documento di 2-3 pagine con esempi di payload claim, risposte Graph, vincoli scoperti.

Senza spike rischiamo di costruire un modello dati (`User.managerId`, tabella `Team`, ecc.) che poi scopriamo essere ridondante o non sincronizzabile con Entra.

#### Q2. Granularità per-sede vs aziendale

- Le **festività e chiusure** sono gestite per-sede (Bari ha chiuso il 6/12, Milano lavora) o sono uniformi azienda-wide?
- I **posti riservati per categoria** (es. stagisti) sono per-sede o cross-sede?

Risposta determina se le entità nuove portano `siteId` opzionale o no.

#### Q3. Dove vivono i parametri configurabili

Per `MAX_DAYS_AHEAD` e simili: env (status quo) vs tabella DB con console.

- **Env**: redeploy a ogni cambio. Ok se cambiano 2 volte l'anno.
- **DB**: console admin, refresh runtime. Più infrastruttura, ma necessario se cambiano spesso o se diversi parametri sono per-sede.

Per progettare ha senso fare una stima realistica della frequenza di cambio.

#### Q4. Modello permessi: role-based vs attribute-based

- **RBAC** (role-based, semplice): un utente ha un ruolo, il ruolo ha permessi statici. Semplice, copre USER/MANAGER/ADMIN.
- **ABAC** (attribute-based): permessi calcolati da attributi (sede, ruolo, riporti, ecc.). Più flessibile, più complesso.

Per il caso d'uso attuale (tre ruoli + scoping per riporti) RBAC sembra sufficiente, ma se in futuro spuntano regole tipo "il responsabile di Bari vede solo Bari" si scivola verso ABAC.

---

### Roadmap propedeutica suggerita

Niente codice finché Q1-Q4 non hanno una risposta. Ordine consigliato:

1. **Spike Entra ID** (Q1) — 1-2 giorni. Decide il modello dati di ruoli e riporti.
2. **Conversazione con HR/Manager** (Q2 + Q3) — capire cadenza realistica di chiusure e cambio parametri.
3. **Decisione modello permessi** (Q4) — RBAC vs ABAC.
4. Solo allora: progettazione di schema e API per Pagina Admin (B) e per le eccezioni dinamiche (C).
5. Implementazione incrementale, partendo dalla pagina di sola visibilità (read-only) e aggiungendo azioni dopo.

- **Priority**: 🟡 MED (non urgente fino al go-live aziendale, ma blocca qualunque feature multi-utente "vera")
- **Stato**: 🟡 IN ANALISI