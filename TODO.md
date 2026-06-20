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

Tre dimensioni indipendenti che ne discendono:
- **Visibilità**: già fatta per ADMIN su `/admin/reservations` (read-only). Da estendere a MANAGER con scoping riporti.
- **Prenotazione per altri**: estendere `POST /reservations` con `userId` opzionale (RolesGuard). Prossimo step.
- **Cancellazione di altri**: rilassare il check `r.userId !== userId` quando il chiamante è MANAGER (sui riporti) o ADMIN (su tutti). Prossimo step.

#### (C) Eccezioni e parametri dinamici (da progettare)

Cose che oggi non esistono ma che l'amministratore vorrà modificare senza redeploy:

- **Giorni bloccati** (festività, chiusure di sede). Modello: nuova entità `Closure` con `(date, siteId)` (per-sede da Q2). Frontend: cella calendar grigia "bloccato", `create()` rifiuta. Da progettare — vedi prossimo step nella sezione "Azioni admin (next)" sotto.
- **Posti riservati a categorie** (manager, stagisti). Due strade: (a) prenotazioni "pre-caricate" da HR per conto degli interessati (riusa il pattern di prenotazione per altri); (b) annotare `Spot` con flag/lista di ruoli ammessi (`reservedFor: Role[]`). (a) meno invasiva ma sposta lavoro su HR, (b) automatica ma schema + logica filtro più ricchi.

#### Azioni admin (next step concreti, su `/admin/reservations`)

Pronti dopo il commit corrente:
- **Prenota per conto di un utente** (estensione di B). UX da decidere — vedi conversazione.
- **Cancella prenotazione di un utente** (estensione di B). Click su riga → modal cancel come oggi su `/my-reservations`.
- **Blocca giorno** (parte di C). Soluzione "veloce" hack-y senza nuove tabelle (reservation fantoccio per ogni spot del filtro) vs soluzione clean con tabella `Closure`. Da decidere.
- **Sezione config** parametri DB-level (parte di C, decisione Q3 dice "non ora — env").
- **Export** CSV / Excel — fase 2, dopo che la pagina vede uso reale.

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