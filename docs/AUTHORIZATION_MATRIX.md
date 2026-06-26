# Authorization Matrix

> **Snapshot del 2026-06-26.** La sorgente di verità sono:
> - i controller NestJS in [`apps/api/src/**/*.controller.ts`](../apps/api/src) (guard `JwtAuthGuard` + `RolesGuard` + decoratore `@Roles`);
> - il matcher + la logica di [`apps/web/src/middleware.ts`](../apps/web/src/middleware.ts) (protezione pagine Next.js);
> - il route handler del BFF proxy [`apps/web/src/app/api/proxy/[...path]/route.ts`](../apps/web/src/app/api/proxy/%5B...path%5D/route.ts) (firma il JWT per l'API; 401 se non c'è sessione).
>
> In caso di dubbio leggi il codice — questa matrice può essere out-of-date.
>
> **Quando aggiungi/modifichi una rotta protetta, aggiorna questo file nello stesso commit.**

## Legenda

| Simbolo | Significato |
|---|---|
| ✅ | Accesso consentito (logica di business permettendo) |
| ❌ | Pagina: il middleware redirige a `/403` (`Accesso Negato`) — autenticato ma ruolo insufficiente |
| ↪ | Pagina: il middleware redirige a `/login?callbackUrl=...` (utente non autenticato) |
| 🔒 | API: ritorna **403 Forbidden** (autenticato, ruolo insufficiente — `RolesGuard`) |
| 🚪 | API: ritorna **401** (non autenticato — il proxy BFF non trova la sessione, `{"error":"unauthorized-at-proxy"}`) |

I ruoli sono definiti in:
- Enum applicativo (Zod): [`packages/shared/src/enums.ts`](../packages/shared/src/enums.ts) → `RoleSchema = z.enum(["USER", "ADMIN"])`
- Enum DB (Prisma): [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma) → `enum Role { USER, ADMIN }`

Il ruolo `ADMIN` è assegnato via env `ADMIN_EMAILS` nel callback `jwt` di NextAuth ([`apps/web/src/lib/auth.ts`](../apps/web/src/lib/auth.ts)).

- **GUEST** — non un vero ruolo: indica un utente non autenticato (nessun JWT / nessuna sessione NextAuth)
- **USER** — utente autenticato (Google o w3id) con ruolo USER
- **MANAGER** — utente con ruolo MANAGER (claim w3id `ibmEdIsManager==="Y"`): come USER + viste scoped ai propri riporti diretti su `/manager/*`
- **ADMIN** — utente autenticato con ruolo ADMIN (email in `ADMIN_EMAILS`)

## Pagine (Next.js)

Protezione applicata da [`middleware.ts`](../apps/web/src/middleware.ts). Il matcher copre `/parking/*`, `/desks/*`, `/my-reservations/*`, `/admin/*`, `/manager/*`. Le pagine **non** nel matcher sono pubbliche (vedi sezione "Rotte pubbliche").

| Path | GUEST | USER | MANAGER | ADMIN | Note |
|---|---|---|---|---|---|
| `/` | ✅ | ✅ ↪ `/my-reservations` | ✅ ↪ `/my-reservations` | ✅ ↪ `/admin/reservations` | Landing pubblica; se autenticato, redirect server-side per ruolo ([`app/page.tsx`](../apps/web/src/app/page.tsx)). MANAGER atterra come USER su `/my-reservations` (il team è raggiungibile da nav "Il mio team") |
| `/login` | ✅ | ✅ | ✅ | ✅ | Pubblica; legge `?callbackUrl` per il redirect post-login |
| `/403` | ✅ | ✅ | ✅ | ✅ | Pagina "Accesso Negato"; non nel matcher |
| `/parking` | ↪ | ✅ | ✅ | ✅ | |
| `/desks` | ↪ | ✅ | ✅ | ✅ | |
| `/my-reservations` | ↪ | ✅ | ✅ | ✅ | |
| `/manager/reservations` | ↪ | ❌ | ✅ | ❌ | Solo MANAGER (l'admin usa `/admin/*`; gate pagina coerente col gate API `@Roles(MANAGER)`) |
| `/admin/reservations` | ↪ | ❌ | ❌ | ✅ | |
| `/admin/closures` | ↪ | ❌ | ❌ | ✅ | |
| `/admin/spot-groups` | ↪ | ❌ | ❌ | ✅ | Gestione gruppi di riserva postazioni (C7) |

> **Ordine di valutazione del middleware**: il callback `authorized` di `withAuth` (richiede `token` presente) gira **prima** della funzione middleware. GUEST (nessun token) → redirect a `/login` *prima* del check del ruolo. USER su `/admin/*` (token presente, ruolo ≠ ADMIN) → la funzione middleware gira e redirige a `/403`.

## API (NestJS, raggiunte via BFF proxy `/api/proxy/*`)

Tutte le route sono dietro il proxy: il browser non parla mai direttamente con NestJS. Il proxy firma un JWT HS256 dalla sessione NextAuth; **senza sessione ritorna 401** (`🚪`) *prima* di inoltrare. Con sessione, l'autorizzazione fine è del backend (`JwtAuthGuard` → 401 se token invalido, `RolesGuard` → 403 se ruolo insufficiente).

| Method + Path | GUEST | USER | MANAGER | ADMIN | Guard / Note |
|---|---|---|---|---|---|
| `GET /health` | ✅ | ✅ | ✅ | ✅ | Nessun guard (health check infra). Via proxy richiede comunque sessione |
| `GET /me` | 🚪 | ✅ | ✅ | ✅ | `JwtAuthGuard` |
| `GET /sites` | 🚪 | ✅ | ✅ | ✅ | `JwtAuthGuard` |
| `GET /sites/:id/floors` | 🚪 | ✅ | ✅ | ✅ | `JwtAuthGuard` |
| `GET /spots` | 🚪 | ✅ | ✅ | ✅ | `JwtAuthGuard` |
| `GET /spots/availability` | 🚪 | ✅ | ✅ | ✅ | `JwtAuthGuard` |
| `GET /closures` | 🚪 | ✅ | ✅ | ✅ | `JwtAuthGuard` (lista user-level per overlay calendar) |
| `GET /reservations/me` | 🚪 | ✅ **(own)** | ✅ **(own)** | ✅ **(own)** | `JwtAuthGuard` + ownership: solo le proprie |
| `POST /reservations` | 🚪 | ✅ **(self)** | ✅ **(self)** | ✅ **(self)** | `JwtAuthGuard`; `userId` preso dal token (prenota per sé) |
| `DELETE /reservations/:id` | 🚪 | ✅ **(own)** | ✅ **(own)** | ✅ **(own)** | `JwtAuthGuard` + ownership: 404 se non è propria |
| `GET /manager/reservations` | 🚪 | 🔒 | ✅ **(scope)** | 🔒 | `RolesGuard MANAGER` + scope: solo riporti diretti + sé |
| `POST /manager/reservations` | 🚪 | 🔒 | ✅ **(scope)** | 🔒 | `RolesGuard MANAGER`; `userId` ∈ riporti+sé, altrimenti 403 |
| `POST /manager/reservations/bulk` | 🚪 | 🔒 | ✅ **(scope)** | 🔒 | `RolesGuard MANAGER`; tutti gli `userIds` ∈ scope (403 fail-fast) |
| `POST /manager/reservations/bulk-cancel` | 🚪 | 🔒 | ✅ **(scope)** | 🔒 | `RolesGuard MANAGER`; cancella solo ACTIVE dei riporti+sé |
| `PATCH /manager/reservations/:id` | 🚪 | 🔒 | ✅ **(scope)** | 🔒 | `RolesGuard MANAGER`; intestatario corrente e nuovo ∈ scope |
| `DELETE /manager/reservations/:id` | 🚪 | 🔒 | ✅ **(scope)** | 🔒 | `RolesGuard MANAGER`; 404 se fuori scope |
| `GET /manager/spots` | 🚪 | 🔒 | ✅ | 🔒 | `RolesGuard MANAGER` (bypassa vincolo temporale, come admin) |
| `GET /manager/users` | 🚪 | 🔒 | ✅ **(scope)** | 🔒 | `RolesGuard MANAGER`; ritorna solo riporti diretti + sé |
| `GET /admin/reservations` | 🚪 | 🔒 | 🔒 | ✅ | `RolesGuard ADMIN` |
| `POST /admin/reservations` | 🚪 | 🔒 | 🔒 | ✅ | `RolesGuard ADMIN` (prenota per altri) |
| `POST /admin/reservations/bulk` | 🚪 | 🔒 | 🔒 | ✅ | `RolesGuard ADMIN` (caricamento massivo) |
| `POST /admin/reservations/bulk-cancel` | 🚪 | 🔒 | 🔒 | ✅ | `RolesGuard ADMIN` (cancellazione massiva) |
| `PATCH /admin/reservations/:id` | 🚪 | 🔒 | 🔒 | ✅ | `RolesGuard ADMIN` (transfer intestatario) |
| `DELETE /admin/reservations/:id` | 🚪 | 🔒 | 🔒 | ✅ | `RolesGuard ADMIN` (cancella prenotazione altrui) |
| `GET /admin/spots` | 🚪 | 🔒 | 🔒 | ✅ | `RolesGuard ADMIN` (bypassa vincolo temporale) |
| `GET /admin/users` | 🚪 | 🔒 | 🔒 | ✅ | `RolesGuard ADMIN` (lista per MultiSelect) |
| `GET /admin/closures` | 🚪 | 🔒 | 🔒 | ✅ | `RolesGuard ADMIN` |
| `POST /admin/closures` | 🚪 | 🔒 | 🔒 | ✅ | `RolesGuard ADMIN` (bulk-create) |
| `POST /admin/closures/bulk-delete` | 🚪 | 🔒 | 🔒 | ✅ | `RolesGuard ADMIN` |
| `DELETE /admin/closures/:id` | 🚪 | 🔒 | 🔒 | ✅ | `RolesGuard ADMIN` |
| `GET /admin/spot-groups` | 🚪 | 🔒 | 🔒 | ✅ | `RolesGuard ADMIN` (lista gruppi + capienza per sede, C7) |
| `POST /admin/spot-groups` | 🚪 | 🔒 | 🔒 | ✅ | `RolesGuard ADMIN` (crea gruppo) |
| `GET /admin/spot-groups/:id` | 🚪 | 🔒 | 🔒 | ✅ | `RolesGuard ADMIN` (dettaglio: membri + postazioni) |
| `DELETE /admin/spot-groups/:id` | 🚪 | 🔒 | 🔒 | ✅ | `RolesGuard ADMIN` (elimina; postazioni tornano aperte a tutti) |
| `PUT /admin/spot-groups/:id/members` | 🚪 | 🔒 | 🔒 | ✅ | `RolesGuard ADMIN` (replace membri) |
| `PUT /admin/spot-groups/:id/spots` | 🚪 | 🔒 | 🔒 | ✅ | `RolesGuard ADMIN` (replace postazioni riservate) |

## Note

- **GUEST + API**: il client non riceve un redirect HTML ma un **401 JSON** dal proxy (`{"error":"unauthorized-at-proxy"}`). Il proxy `/api/proxy/[...path]` **non** è nel matcher del middleware: è il route handler stesso che, via `getToken`, verifica la sessione e ritorna 401 quando assente — *prima* di inoltrare al backend.

- **Ownership check oltre al ruolo** — route che passano la guard ma filtrano per `userId`:
  - `GET /reservations/me` → ritorna solo le prenotazioni dell'utente del token.
  - `POST /reservations` → crea sempre per l'utente del token (un USER non può prenotare per altri; quel flusso è solo admin via `POST /admin/reservations`).
  - `DELETE /reservations/:id` → [`ReservationsService.cancel`](../apps/api/src/reservations/reservations.service.ts) con `isAdmin=false` verifica `r.userId === userId`; se non combacia ritorna **404** (non 403, per non rivelare l'esistenza di prenotazioni altrui). Gli endpoint admin passano `isAdmin=true` e saltano il check.

- **Closure non bloccano l'admin a livello di guard ma a livello di business**: `POST /admin/reservations` (e bulk) chiamano `create()` che applica `assertNotBlocked` → 409 se il giorno è bloccato. Non è autorizzazione (è una regola di business), quindi non compare in questa matrice.

- **Postazioni riservate (C7 + C7.1) — eligibilità a livello di business, non di guard**: l'eligibilità è bidirezionale e NON è espressa dal `RolesGuard` (vale per qualunque ruolo, ADMIN incluso quando prenota *per* un utente). Regola unica in `SpotGroupsService.isSpotBookable` ([spot-groups.service.ts](../apps/api/src/spot-groups/spot-groups.service.ts)):
  - **C7 (vincolo sullo spot)**: una postazione con `reservedGroupId` è prenotabile solo dai membri di quel gruppo.
  - **C7.1 (vincolo inverso sul membro, per-tipo)**: un membro di un gruppo che riserva postazioni di un certo tipo può prenotare, per quel tipo, **solo** le postazioni del suo gruppo (niente posti aperti, niente fallback). Per i tipi non coperti dal suo gruppo si comporta come un utente normale.
  - **Appartenenza esclusiva**: un utente sta in al più un gruppo (FK `User.reservedGroupId`).
  - `GET /spots` / `GET /spots/availability` marcano gli spot con `lockedForMe`/`reservedGroupName` e contano come disponibili solo quelli prenotabili dall'utente target (totali *eligibility-aware*). Per uno spot aperto bloccato dal vincolo inverso `reservedGroupName` è null (la UI mostra un messaggio dedicato).
  - `POST /reservations` e i flussi admin/manager `create`/`bulkCreate` rifiutano (**403** / skip nel bulk) gli spot non prenotabili dall'intestatario, con messaggio diverso per i due casi.
  - La chiusura ha priorità sulla riserva (closure check prima dell'eligibilità).

- **Rotte completamente pubbliche** (non nel matcher di `middleware.ts`, nessun guard):
  - tutte le route `/api/auth/*` (gestite da NextAuth)
  - `/` (landing), `/login`, `/403`
  - asset statici (`/_next/*`, file con estensione, `favicon`, ecc.)
