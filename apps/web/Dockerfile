# syntax=docker/dockerfile:1.7
# Build context atteso = root del monorepo. Comando tipico:
#   docker build -f apps/web/Dockerfile -t reservation-app/web:local .

# ----------------------------- base ------------------------------------------
FROM node:20-bookworm-slim AS base
RUN corepack enable
WORKDIR /repo

# ----------------------------- build -----------------------------------------
FROM base AS build

# 1) Manifest + lockfile per il layer di cache delle dipendenze.
#    `--ignore-scripts` salta i postinstall: il web non ne ha bisogno (niente
#    Prisma, niente nest), e così evitiamo di trascinare apps/api/prisma/ nel
#    build context del web solo per non far fallire il postinstall altrui.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# 2) Sorgenti necessari al build di Next (api source non serve qui).
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web

# 3) Build workspace dep prima (web ne usa i tipi via transpilePackages).
RUN pnpm --filter @reservation/shared build

# 4) `next build` con output: "standalone" produce in apps/web/.next/standalone/
#    un bundle self-contained con server.js + node_modules tracciati.
#    NEXTAUTH_URL/SECRET ecc. sono LETTI A RUNTIME, non a build, quindi non
#    servono qui.
#    Le `NEXT_PUBLIC_*` invece Next le INLINEA nel bundle JS al build, quindi
#    devono essere disponibili adesso. Le riceviamo come build-arg dal compose
#    e le promuoviamo a ENV così `next build` le vede via process.env.
ARG NEXT_PUBLIC_MAX_DAYS_AHEAD=30
ENV NEXT_PUBLIC_MAX_DAYS_AHEAD=$NEXT_PUBLIC_MAX_DAYS_AHEAD
RUN pnpm --filter @reservation/web exec next build

# ----------------------------- runtime ---------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
# Next.js (server) ascolta su HOSTNAME:PORT. 0.0.0.0 è obbligatorio dentro
# container, altrimenti binda solo loopback.
ENV HOSTNAME=0.0.0.0
# ca-certificates aggiornati per TLS verso Google OAuth (e altri IdP futuri).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Layout standalone in monorepo (con experimental.outputFileTracingRoot = root):
#   apps/web/.next/standalone/
#     ├── apps/web/server.js          ← entrypoint
#     ├── apps/web/.next/             ← build artifacts (no static, vedi sotto)
#     ├── node_modules/               ← solo le deps tracciate
#     └── package.json
#   apps/web/.next/static/            ← da copiare a parte
#
# Il standalone NON include `.next/static/` né `public/`: vanno copiati a mano.
# `public/` non esiste nel repo oggi, quindi quel COPY è omesso.
# `--chown=node:node` evita problemi di permessi a runtime (cache .next, ecc.).
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static

USER node
EXPOSE 3000

# Health probe via Node stesso. Next server risponde 200 anche su `/` (login).
# `/api/health` non esiste lato web, quindi probe-iamo la root.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/', r => process.exit(r.statusCode < 500 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "apps/web/server.js"]
