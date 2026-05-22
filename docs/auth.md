# Flusso di autenticazione

Documento di architettura per Sprint 1. In dev usiamo Google OAuth; in produzione passeremo a Entra ID — vedi sezione finale.

## Attori

- **Browser** — utente che apre l'app in `http://localhost:3000`.
- **Web (Next.js, BFF)** — `apps/web`. Tiene la sessione e fa da proxy verso l'API.
- **API (NestJS)** — `apps/api`. Stateless: si fida solo di un JWT firmato dal BFF.
- **IdP** — Google in dev, Entra ID in prod. Emette l'identità.
- **DB (Postgres)** — modelli `User` + `Account` per il provisioning.

Principio chiave: **il browser non vede mai il token dell'IdP**. Il BFF lo tiene in un cookie `httpOnly` e ri-firma un JWT pulito per l'API.

## Fase 1 — Login (una volta a sessione)

```
Browser ──/login──▶ Web (NextAuth)
   │                   │
   │   ◀── 302 ─── signIn("google")
   │
   ├──▶ accounts.google.com  (consenso)
   │
   │   ◀── 302 ── /api/auth/callback/google?code=…
   │
   │                   Web scambia code → id_token + profile (server-to-server)
   │                   callback `jwt`: arricchisce token con
   │                     { provider, providerSub, email, name, role }
   │                   role = ADMIN se email ∈ ADMIN_EMAILS, altrimenti USER
   │                   NextAuth cifra (JWE) il JWT col NEXTAUTH_SECRET
   │
   ◀── Set-Cookie: next-auth.session-token=… (httpOnly, Secure, SameSite=Lax)
```

Riferimenti:
- [apps/web/src/lib/auth.ts](../apps/web/src/lib/auth.ts) — `authOptions`, callback `jwt`/`session`, `isAdmin()`.
- [apps/web/src/app/api/auth/[...nextauth]/route.ts](../apps/web/src/app/api/auth/%5B...nextauth%5D/route.ts) — handler NextAuth.
- [apps/web/src/middleware.ts](../apps/web/src/middleware.ts) — protegge `/parking`, `/desks`, `/my-reservations`: senza sessione → redirect a `/login`.

## Fase 2 — Richiesta autenticata (ogni API call)

Il frontend chiama **solo** `/api/proxy/<path>` (stesso origin → cookie incluso). Mai direttamente `localhost:3001`.

```
Browser ──GET /api/proxy/me── (cookie next-auth)──▶ Web BFF
                                                     │
                                                     │ getToken({ req, secret })
                                                     │   → decifra JWE → payload
                                                     │
                                                     │ jwt.sign({sub,provider,email,name,role},
                                                     │          NEXTAUTH_SECRET, HS256, 1h)
                                                     │
                                                     ▼
                                          NestJS API  ──Authorization: Bearer <jwt>──▶
                                                     │
                                                     │ passport-jwt verifica HS256 con
                                                     │   lo stesso NEXTAUTH_SECRET
                                                     │
                                                     │ JwtAuthGuard popola req.user = payload
                                                     │ UsersService.provisionFromToken()
                                                     │   lookup per (provider, providerSub)
                                                     │   → fallback per email → crea User+Account
                                                     │
                                                     ▼
                                           ◀── 200 { id, email, displayName, role }
```

Riferimenti:
- [apps/web/src/app/api/proxy/[...path]/route.ts](../apps/web/src/app/api/proxy/%5B...path%5D/route.ts) — legge sessione, ri-firma HS256, inoltra a `API_INTERNAL_URL`.
- [apps/api/src/auth/jwt.strategy.ts](../apps/api/src/auth/jwt.strategy.ts) — `passport-jwt` con `secretOrKey: NEXTAUTH_SECRET`, `algorithms: ["HS256"]`.
- [apps/api/src/auth/jwt-auth.guard.ts](../apps/api/src/auth/jwt-auth.guard.ts) — guard NestJS.
- [apps/api/src/auth/roles.guard.ts](../apps/api/src/auth/roles.guard.ts) + [roles.decorator.ts](../apps/api/src/auth/roles.decorator.ts) — autorizzazione per ruolo.
- [apps/api/src/users/users.service.ts](../apps/api/src/users/users.service.ts) — `provisionFromToken`: lookup `(provider, providerSub)` → fallback per email → create.
- [apps/api/prisma/schema.prisma](../apps/api/prisma/schema.prisma) — modelli `User` e `Account` con `@@unique([provider, providerSub])`.

## Perché queste scelte

**BFF + cookie httpOnly.** Un eventuale XSS nel frontend non può leggere `document.cookie` (è `httpOnly`) né esfiltrare il token Google. Il browser ha solo un identificatore opaco di sessione.

**HS256 con segreto condiviso.** Web e API sono nello stesso trust boundary (stesso team, stesso deploy). Usare un segreto condiviso evita di esporre JWKS o gestire chiavi asimmetriche in dev. In prod, se l'API venisse separata, si passerebbe a RS256 + JWKS senza toccare il flusso.

**JWT ri-firmato dal BFF, non passthrough del token IdP.** L'API non deve sapere chi è l'IdP. Riceve un JWT minimale (`sub`, `provider`, `email`, `role`) che è la stessa shape per Google oggi e Entra domani. Cambiare provider non tocca NestJS.

**Modello `Account` separato da `User`.** Un utente può avere più identità federate (oggi Google personale, domani Entra aziendale): collegate per `email`. Schema ispirato a NextAuth ma gestito da noi nel DB applicativo.

**Ruolo derivato da env (`ADMIN_EMAILS`).** Sufficiente per MVP. Quando servirà, sostituibile con un campo `role` editabile in admin UI senza impatti sul flusso.

## Variabili ambiente coinvolte

| Variabile | Lato | Scopo |
|---|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | web | provider OAuth NextAuth |
| `NEXTAUTH_SECRET` | **web e api** | cifra il cookie NextAuth e firma/verifica il JWT verso l'API. Deve essere identico nei due processi. |
| `NEXTAUTH_URL` | web | URL pubblico dell'app (callback OAuth) |
| `API_INTERNAL_URL` | web | dove il BFF inoltra (es. `http://localhost:3001`) |
| `ADMIN_EMAILS` | web | CSV di email che ricevono `role: ADMIN` |
| `DATABASE_URL` | api | connessione Postgres |

## Migrazione a Entra ID (produzione)

Il passaggio è isolato a `apps/web`:

1. In [apps/web/src/lib/auth.ts](../apps/web/src/lib/auth.ts) sostituire `GoogleProvider` con `AzureADProvider` (`next-auth/providers/azure-ad`) — `clientId`, `clientSecret`, `tenantId`.
2. Nella callback `jwt`, `account.provider` diventerà `"azure-ad"` e `account.providerAccountId` l'`oid` Entra. Il resto del codice (`providerSub`, ri-firma HS256) è già provider-agnostic.
3. NestJS **non cambia**: continua a verificare l'HS256 con `NEXTAUTH_SECRET`. La stringa `provider` cambia da `"google"` a `"azure-ad"` nel `Account`, ma la lookup `(provider, providerSub)` continua a funzionare.
4. Per gli utenti già registrati con Google: al primo login Entra, il fallback per email in `provisionFromToken` collega un nuovo `Account` al `User` esistente.
5. Configurare in Azure: redirect URI `https://<dominio>/api/auth/callback/azure-ad`, scope minimi `openid profile email`.

Nessuna modifica al BFF proxy né al guard NestJS.
