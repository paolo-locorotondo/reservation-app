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

## Pannello filtri collassabile

Sopra le tabelle (`SpotsBrowser`, `MyReservationsList`) il blocco filtri Sede/Piano/Data + filtro secondario Zona occupa parecchio spazio verticale, soprattutto su mobile dove la tabella resta sotto il fold.

- Avvolgere `.rsv-filter-grid` + `.rsv-secondary-filter` in un componente collassabile (probabilmente Carbon `Accordion` con un solo `AccordionItem`, o un toggle custom con icona chevron).
- Stato di default: **espanso su desktop, collassato su mobile** (`@media (max-width: 671px)` setta lo stato iniziale).
- Quando è collassato e ci sono filtri attivi, mostrare un riepilogo testuale (es. "Sede: Bari · Piano 2 · 2026-05-26") e un badge col numero di filtri attivi, così l'utente sa che la lista è filtrata anche senza espandere.
- **Priority**: 🟡 MED (utile ma non bloccante)
- **Stato**: 🔴 TODO

## Legenda con conteggi + filtro per stato

Estendere la legenda di `SpotsBrowser` da decorativa a interattiva.

- Mostrare il conteggio: `Disponibile (N)` / `Occupato (M)`, calcolato sui `filteredRows` (così riflette i filtri colonna).
- Cliccando "Disponibile" filtra solo le righe `available`; cliccando "Occupato" solo le `!available`. Terzo click rimuove il filtro stato (ciclo come il sort).
- Visivamente: i due item della legenda diventano pillole/chip cliccabili (`button` con `aria-pressed`), evidenziate quando attive.
- Aggiungere uno stato `statusFilter: "AVAILABLE" | "OCCUPIED" | null` in `SpotsBrowser` e applicarlo nello step di filtraggio (prima di `colFilters`).
- Si applica solo a `SpotsBrowser` (in `MyReservationsList` tutto è ACTIVE per definizione, non ha senso).
- **Priority**: 🟡 MED
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

## Aggiornamento dati tabella (real-time vs manuale)

Oggi la tabella posti si aggiorna solo dopo `BookingDialog onSuccess` (incrementa `reloadTick`). Se un altro utente prenota mentre sto guardando, lo scopro solo cliccando "Prenota" e ricevendo il 409. UX migliorabile.

Tre opzioni, da valutare insieme prima di implementare:

- **a) Polling**: `setInterval` (es. ogni 30–60s) per richiamare `listSpots` con gli stessi filtri. Pro: zero attrito. Contro: traffico inutile quando la tab è in background; va sospeso con `document.visibilityState === "hidden"`.
- **b) Tasto Refresh manuale**: icona `Renew` sopra la tabella che incrementa `reloadTick`. Pro: zero traffico inutile, controllo esplicito. Contro: l'utente deve ricordarselo.
- **c) Refresh on interaction**: ogni click su una riga (e fallimento del booking) ricarica. Pro: l'utente non vede mai un 409 "a sorpresa". Contro: ritardo aggiuntivo prima di aprire il modal.
- **Possibile combinazione**: (b) sempre, + (a) leggero (60s) solo quando tab in foreground, + (c) come fallback dopo un 409 (ricarica e mostra subito lo stato vero).
- Soluzione "vera" sarebbe SSE/WebSocket, ma fuori scope MVP.
- **Priority**: 🟡 MED
- **Stato**: 🔴 TODO

## Vista Calendario per "Le mie prenotazioni" (e magari /spots)

Sostituire (in opzione, non rimuovendo l'attuale) il DatePicker con una vista calendario mensile più ricca, ispirata al popup del DatePicker.

Approccio incrementale richiesto dall'utente:

1. **Congelare** l'attuale `MyReservationsList` (vista "lista").
2. **Creare** una nuova vista `MyReservationsCalendar` (componente fratello).
3. Aggiungere un toggle "Vista Calendario" / "Vista Lista" in alto alla pagina (Carbon `ContentSwitcher` o `Toggle`).
4. La vista calendario mostra il mese corrente:
   - ogni giorno ha un **pallino verde** se ci sono ancora posti disponibili (in base ai filtri Sede/Piano/Tipo selezionati per quel giorno);
   - **pallino rosso** se i posti sono tutti occupati;
   - opzionalmente il **numero** di posti residui dentro il pallino (es. `3` per "ne restano 3");
   - i giorni in cui l'utente ha già una propria prenotazione attiva sono evidenziati (bordo o icona).
5. Cliccando un giorno → si torna alla vista lista (oppure naviga a `/parking?date=YYYY-MM-DD`) col filtro Data preimpostato.

Aspetti tecnici:

- **Costo dati**: per disegnare i pallini servono i conteggi disponibilità per ciascuno dei ~30 giorni del mese visibile. Oggi `/spots?date=...` accetta una sola data → serve un nuovo endpoint `GET /spots/availability?from&to&siteId&floorId&type` che ritorna `[{ date, available, total }]`. Da progettare con cura per non far esplodere il payload.
- **Componente calendario**: valutare riuso del flatpickr embedded (Carbon `DatePicker` può essere "inline"), oppure scrivere una griglia 7×N custom — più libertà sul rendering dei pallini ma più codice.
- **Generalizzazione**: se funziona bene per `/my-reservations`, valutare un toggle simile su `/parking` e `/desks`.
- **Priority**: 🟢 LOW (feature di esplorazione, dipende dall'endpoint nuovo)
- **Stato**: 🔴 TODO