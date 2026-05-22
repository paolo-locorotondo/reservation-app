# Reservation App

Web app per la prenotazione di **posti auto** nel parcheggio aziendale e di **scrivanie** negli uffici. Auth SSO con Microsoft Entra ID.

> Stato: **Sprint 0 — Bootstrap** completato. Auth e prenotazioni nei prossimi sprint.

## Stack

- **Monorepo** [pnpm workspaces](pnpm-workspace.yaml)
- **Backend** [NestJS](apps/api/) (TypeScript) + [Prisma](apps/api/prisma/schema.prisma) + PostgreSQL
- **Frontend** [Next.js](apps/web/) (App Router) + [IBM Carbon Design System](https://carbondesignsystem.com/)
- **Schemi condivisi** [`packages/shared`](packages/shared/) (Zod)
- **Auth** Microsoft Entra ID via NextAuth, pattern BFF (token mai esposti al browser)
- **Dev infra** Docker Compose (Postgres + Adminer)

Vedi il piano completo in [twinkling-humming-whisper.md](../../../.claude/plans/twinkling-humming-whisper.md).

## Prerequisiti

- Node.js **20.x** (`node -v`)
- pnpm **>=9** (`npm install -g pnpm`)
- Docker Desktop (per Postgres locale)

## Bootstrap (prima volta)

```bash
# 1. Clona / entra nella cartella
cd reservation-app

# 2. File di environment
cp .env.example .env

# 3. Installa tutte le dipendenze del monorepo
pnpm install

# 4. Avvia Postgres + Adminer in Docker
pnpm db:up

# 5. Genera il client Prisma + crea le tabelle + popola dati di esempio
pnpm db:migrate
pnpm db:seed
```

## Avvio in sviluppo

In due terminali separati (oppure usa `pnpm dev` per lanciarli in parallelo):

```bash
pnpm --filter @reservation/api dev    # http://localhost:3001/api
pnpm --filter @reservation/web dev    # http://localhost:3000
```

Health check: <http://localhost:3001/api/health>
Adminer (DB UI): <http://localhost:8080>  — server `postgres`, user/pass `reservation`/`reservation`, db `reservation`.

## Struttura

```
reservation-app/
├── apps/
│   ├── api/                  # NestJS API
│   └── web/                  # Next.js frontend
├── packages/
│   └── shared/               # Zod schemas + tipi condivisi
├── docker-compose.yml        # Postgres + Adminer
└── .env.example
```

## Comandi root utili

| Comando | Cosa fa |
|---------|---------|
| `pnpm dev` | Avvia api e web in parallelo |
| `pnpm db:up` / `pnpm db:down` | Avvia / ferma Postgres in Docker |
| `pnpm db:migrate` | Applica le migration Prisma |
| `pnpm db:seed` | Popola il DB con dati di esempio |
| `pnpm db:reset` | Resetta DB + rilancia seed |
| `pnpm build` | Build di tutti i package |
| `pnpm test` | Test di tutti i package |

## Roadmap

- [x] Sprint 0 — Bootstrap (monorepo + scaffold + DB + healthcheck)
- [x] Sprint 1 — Auth (Entra ID + NextAuth + BFF + RolesGuard)
- [x] Sprint 2 — Catalogo posti
- [x] Sprint 3 — Prenotazioni (regole + API + UI)
- [ ] Sprint 4 — Rifiniture (responsive, "Le mie prenotazioni", errori)
- [ ] Sprint 5 — Qualità (test, e2e Playwright, README finale)
