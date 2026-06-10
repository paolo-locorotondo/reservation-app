# TODO

Backlog dei prossimi step, in ordine di priorità da discutere. Voci completate nello storico in [CHANGELOG.md](./CHANGELOG.md).

## Pagina Admin (manager / HR)

Pagina riservata ai ruoli `ADMIN` (e da estendere a un eventuale ruolo `MANAGER`/`HR`) per vedere chi ha prenotato cosa e quando.

Aspetti da definire:

- **Scope visibilità**: HR vede tutto il personale; un manager vede solo i diretti riporti? Serve un campo `managerId` su `User`?
- **Filtri attesi**: per intervallo date, sede, piano, tipo posto, utente (search), stato (`ACTIVE` / `CANCELLED`).
- **Colonne della tabella**: Data, Utente (nome + email), Tipo (Posto auto / Scrivania), Codice posto, Sede, Piano, Zona, Stato, Creata il.
- **Azioni admin**: poter cancellare la prenotazione di un altro utente? (utile se uno è in malattia e libera il posto). Da decidere — comportamento oggi: solo l'utente stesso può cancellare.
- **Endpoint backend**: `GET /admin/reservations?from&to&siteId&floorId&type&userId&status` protetto da `RolesGuard(['ADMIN'])`. Restituisce reservation + user + spot expanded.
- **Export**: CSV/Excel utile per HR? (probabilmente sì in fase 2).
- **UI**: riusa il pattern `DataTable` + filtri header già usato in `SpotsBrowser` / `MyReservationsList`.
- **Routing**: `apps/web/src/app/(app)/admin/reservations/page.tsx`. Voce in `UIShell` visibile solo se `me.role === "ADMIN"`.
- **Seed**: il seed crea già un utente admin di test? Verificare e, se no, aggiungere.
- **Priority**: 🟢 LOW (Per il momento l'Admin può usare query sul DB per fare la stessa cosa)
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

## Vista Calendario su /my-reservations (estensione futura)

La vista calendario è stata implementata su `/parking` e `/desks` (vedi `CHANGELOG.md`): è lì che porta valore concreto, perché l'utente vuole vedere quando sono disponibili i posti del mese.

Su `/my-reservations` resta da valutare se aggiungere lo stesso toggle. Pro: panoramica visiva delle proprie prenotazioni. Contro: l'utente medio ha poche prenotazioni proprie, una griglia mensile di ~30 celle aggiunge poco rispetto alla lista.

Se si decide di farlo, il pattern è già pronto: riutilizzare `SpotsCalendar` con `myReservedDates` come signal primario (non più overlay) e disabilitare il fetch availability.

- **Priority**: 🟢 LOW
- **Stato**: 🔴 TODO (rivalutare dopo qualche settimana di uso reale)