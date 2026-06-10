# syntax=docker/dockerfile:1.7
# Build context atteso = root del monorepo (per accedere a pnpm-workspace.yaml,
# packages/shared, ecc.). Comando tipico:
#   docker build -f apps/api/Dockerfile -t reservation-app/api:local .

# ----------------------------- base ------------------------------------------
FROM node:20-bookworm-slim AS base
# corepack abilita la versione di pnpm dichiarata nel package.json root
# (`packageManager: pnpm@10.x`).
RUN corepack enable
WORKDIR /repo

# ----------------------------- build -----------------------------------------
FROM base AS build

# 1) Manifest + schema Prisma (il postinstall di apps/api esegue
#    `prisma generate`, che richiede schema.prisma già presente).
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/api/prisma apps/api/prisma
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
# `--mount=type=cache` riusa lo store pnpm tra build successivi: la prima volta
# scarica tutto, poi solo il delta. Velocizza i rebuild di 10-30s. La cache è
# locale al builder Docker (non finisce nel layer finale).
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# 2) Sorgenti necessari al build dell'API (web non serve qui).
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api/src apps/api/src
COPY apps/api/tsconfig.json apps/api/nest-cli.json apps/api/

# 3) Build workspace dep prima (api importa @reservation/shared/dist).
#    NB: `prisma generate` non serve qui — il postinstall del passo 1 lo
#    esegue già, e quel layer si invalida automaticamente quando cambia
#    schema.prisma (copiato prima di pnpm install).
RUN pnpm --filter @reservation/shared build

# 4) Compilazione NestJS → apps/api/dist
RUN pnpm --filter @reservation/api exec nest build

# ----------------------------- runtime ---------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3001
# Prisma engine richiede openssl a runtime; ca-certificates per le connessioni
# TLS verso Supabase / IBM Cloud Postgres / Google.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Copia l'intero workspace dal build stage (con node_modules + symlink pnpm).
# È più grande di un bundle "deploy --prod" (include anche le devDeps), ma è
# l'approccio più affidabile con pnpm + workspace + Prisma: i symlink relativi
# di pnpm restano coerenti e `.prisma/client/` non si perde.
# `--chown=node:node` evita problemi a runtime con file di proprietà di root
# quando il processo gira come `node` (cache temporanei, log, ecc.).
WORKDIR /app
COPY --from=build --chown=node:node /repo /app
WORKDIR /app/apps/api

USER node
EXPOSE 3001

# Health check: probe HTTP via Node stesso (no curl/wget da installare).
# /api/health risponde 200 con stato Postgres. start-period generoso perché
# all'avvio il container deve aprire la connessione Supabase.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# `nest build` emette in `dist/src/main.js` (e non `dist/main.js`) perché il
# tsconfig.json include sia `src/**` che `prisma/seed.ts`: senza `rootDir`
# esplicito, TS inferisce la root a `apps/api/` e preserva i sottopath.
CMD ["node", "dist/src/main.js"]
