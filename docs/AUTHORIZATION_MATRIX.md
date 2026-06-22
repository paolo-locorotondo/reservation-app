# Authorization Matrix

> **Snapshot del 2026-06-22.** La sorgente di verità sono:
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
- **USER** — utente autenticato (Google o Entra ID) con ruolo USER
- **ADMIN** — utente autenticato con ruolo ADMIN

## Pagine (Next.js)

Protezione applicata da [`middleware.ts`](../apps/web/src/middleware.ts). Il matcher copre `/parking/*`, `/desks/*`, `/my-reservations/*`, `/admin/*`. Le pagine **non** nel matcher sono pubbliche (vedi sezione "Rotte pubbliche").

| Path | GUEST | USER | ADMIN | Note |
|---|---|---|---|---|
| `/` | ✅ | ✅ ↪ `/my-reservations` | ✅ ↪ `/admin/reservations` | Landing pubblica; se autenticato, redirect server-side per ruolo ([`app/page.tsx`](../apps/web/src/app/page.tsx)) |
| `/login` | ✅ | ✅ | ✅ | Pubblica; legge `?callbackUrl` per il redirect post-login |
| `/403` | ✅ | ✅ | ✅ | Pagina "Accesso Negato"; non nel matcher |
| `/parking` | ↪ | ✅ | ✅ | |
| `/desks` | ↪ | ✅ | ✅ | |
| `/my-reservations` | ↪ | ✅ | ✅ | |
| `/admin/reservations` | ↪ | ❌ | ✅ | |
| `/admin/closures` | ↪ | ❌ | ✅ | |

> **Ordine di valutazione del middleware**: il callback `authorized` di `withAuth` (richiede `token` presente) gira **prima** della funzione middleware. GUEST (nessun token) → redirect a `/login` *prima* del check del ruolo. USER su `/admin/*` (token presente, ruolo ≠ ADMIN) → la funzione middleware gira e redirige a `/403`.

## API (NestJS, raggiunte via BFF proxy `/api/proxy/*`)

Tutte le route sono dietro il proxy: il browser non parla mai direttamente con NestJS. Il proxy firma un JWT HS256 dalla sessione NextAuth; **senza sessione ritorna 401** (`🚪`) *prima* di inoltrare. Con sessione, l'autorizzazione fine è del backend (`JwtAuthGuard` → 401 se token invalido, `RolesGuard` → 403 se ruolo insufficiente).

| Method + Path | GUEST | USER | ADMIN | Guard / Note |
|---|---|---|---|---|
| `GET /health` | ✅ | ✅ | ✅ | Nessun guard (health check infra). Via proxy richiede comunque sessione |
| `GET /me` | 🚪 | ✅ | ✅ | `JwtAuthGuard` |
| `GET /sites` | 🚪 | ✅ | ✅ | `JwtAuthGuard` |
| `GET /sites/:id/floors` | 🚪 | ✅ | ✅ | `JwtAuthGuard` |
| `GET /spots` | 🚪 | ✅ | ✅ | `JwtAuthGuard` |
| `GET /spots/availability` | 🚪 | ✅ | ✅ | `JwtAuthGuard` |
| `GET /closures` | 🚪 | ✅ | ✅ | `JwtAuthGuard` (lista user-level per overlay calendar) |
| `GET /reservations/me` | 🚪 | ✅ **(own)** | ✅ **(own)** | `JwtAuthGuard` + ownership: solo le proprie |
| `POST /reservations` | 🚪 | ✅ **(self)** | ✅ **(self)** | `JwtAuthGuard`; `userId` preso dal token (prenota per sé) |
| `DELETE /reservations/:id` | 🚪 | ✅ **(own)** | ✅ **(own)** | `JwtAuthGuard` + ownership: 404 se non è propria |
| `GET /admin/reservations` | 🚪 | 🔒 | ✅ | `RolesGuard ADMIN` |
| `POST /admin/reservations` | 🚪 | 🔒 | ✅ | `RolesGuard ADMIN` (prenota per altri) |
| `POST /admin/reservations/bulk` | 🚪 | 🔒 | ✅ | `RolesGuard ADMIN` (caricamento massivo) |
| `POST /admin/reservations/bulk-cancel` | 🚪 | 🔒 | ✅ | `RolesGuard ADMIN` (cancellazione massiva) |
| `PATCH /admin/reservations/:id` | 🚪 | 🔒 | ✅ | `RolesGuard ADMIN` (transfer intestatario) |
| `DELETE /admin/reservations/:id` | 🚪 | 🔒 | ✅ | `RolesGuard ADMIN` (cancella prenotazione altrui) |
| `GET /admin/spots` | 🚪 | 🔒 | ✅ | `RolesGuard ADMIN` (bypassa vincolo temporale) |
| `GET /admin/users` | 🚪 | 🔒 | ✅ | `RolesGuard ADMIN` (lista per MultiSelect) |
| `GET /admin/closures` | 🚪 | 🔒 | ✅ | `RolesGuard ADMIN` |
| `POST /admin/closures` | 🚪 | 🔒 | ✅ | `RolesGuard ADMIN` (bulk-create) |
| `POST /admin/closures/bulk-delete` | 🚪 | 🔒 | ✅ | `RolesGuard ADMIN` |
| `DELETE /admin/closures/:id` | 🚪 | 🔒 | ✅ | `RolesGuard ADMIN` |

## Note

- **GUEST + API**: il client non riceve un redirect HTML ma un **401 JSON** dal proxy (`{"error":"unauthorized-at-proxy"}`). Il proxy `/api/proxy/[...path]` **non** è nel matcher del middleware: è il route handler stesso che, via `getToken`, verifica la sessione e ritorna 401 quando assente — *prima* di inoltrare al backend.

- **Ownership check oltre al ruolo** — route che passano la guard ma filtrano per `userId`:
  - `GET /reservations/me` → ritorna solo le prenotazioni dell'utente del token.
  - `POST /reservations` → crea sempre per l'utente del token (un USER non può prenotare per altri; quel flusso è solo admin via `POST /admin/reservations`).
  - `DELETE /reservations/:id` → [`ReservationsService.cancel`](../apps/api/src/reservations/reservations.service.ts) con `isAdmin=false` verifica `r.userId === userId`; se non combacia ritorna **404** (non 403, per non rivelare l'esistenza di prenotazioni altrui). Gli endpoint admin passano `isAdmin=true` e saltano il check.

- **Closure non bloccano l'admin a livello di guard ma a livello di business**: `POST /admin/reservations` (e bulk) chiamano `create()` che applica `assertNotBlocked` → 409 se il giorno è bloccato. Non è autorizzazione (è una regola di business), quindi non compare in questa matrice.

- **Rotte completamente pubbliche** (non nel matcher di `middleware.ts`, nessun guard):
  - tutte le route `/api/auth/*` (gestite da NextAuth)
  - `/` (landing), `/login`, `/403`
  - asset statici (`/_next/*`, file con estensione, `favicon`, ecc.)
