# syntax=docker/dockerfile:1.7
# Uma imagem por serviço, a partir do mesmo build:
#   docker build --target web    --build-arg GIT_SHA=$(git rev-parse HEAD) -t organizeup-web .
#   docker build --target worker --build-arg GIT_SHA=$(git rev-parse HEAD) -t organizeup-worker .
# O worker roda as migrações no boot (MIGRATION_DATABASE_URL) e depois processa as filas.

ARG NODE_VERSION=24

# ---------- dependências e build ----------
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
ARG GIT_SHA=dev
COPY . .
RUN pnpm --filter @organizeup/web build \
 && pnpm --filter @organizeup/worker build
# O Dokploy não passa GIT_SHA: nesse caso o commit vem do .git do clone.
RUN commit="$GIT_SHA"; \
    if [ "$commit" = dev ] && [ -f .git/HEAD ]; then \
      commit=$(cat .git/HEAD); \
      case "$commit" in "ref: "*) commit=$(cat ".git/${commit#ref: }" 2>/dev/null || echo dev) ;; esac; \
    fi; \
    printf '%s' "$commit" > COMMIT

# ---------- runtime comum ----------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
ARG GIT_SHA=dev
ENV NODE_ENV=production \
    APP_COMMIT=${GIT_SHA} \
    NEXT_TELEMETRY_DISABLED=1
LABEL org.opencontainers.image.revision=${GIT_SHA} \
      org.opencontainers.image.source="organizeup"
WORKDIR /app

# ---------- web (Next.js standalone) ----------
FROM runtime AS web
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/COMMIT ./COMMIT
USER node
ENV PORT=3000 \
    HOSTNAME=0.0.0.0
EXPOSE 3000
# probe=live: só o processo (queda do banco não deve reverter/reiniciar containers).
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:3000/api/health?probe=live" || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "export APP_COMMIT=$(cat COMMIT); exec node apps/web/server.js"]

# ---------- worker (bundle único + migrations) ----------
FROM runtime AS worker
COPY --from=build --chown=node:node /repo/apps/worker/dist ./
COPY --from=build --chown=node:node /repo/COMMIT ./COMMIT
USER node
ENV MIGRATIONS_DIR=/app/migrations
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "export APP_COMMIT=$(cat COMMIT); exec node --enable-source-maps main.js"]
