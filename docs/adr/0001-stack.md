# ADR-0001 — Stack e forma de entrega

Status: aceito (2026-10-29)

## Decisão

- **Monorepo pnpm** (`apps/web`, `apps/worker`, `packages/db`, `packages/domain`). Turborepo só quando
  houver mais de três pacotes com build próprio.
- **Next.js 16** (App Router, `output: "standalone"`), React 19, Tailwind 4. Versões fixadas no lockfile.
- **Postgres 17** (imagem `pgvector/pgvector`) + **Drizzle ORM** para consultas; migrações em **SQL puro**
  aplicadas pelo nosso migrador (checksum, lock, roles, grants).
- **pg-boss** como fila (no próprio Postgres; sem Redis).
- **Better Auth** (e-mail/senha; plugin `organization` = household). 2FA entra na Fase 7.
- **TypeScript 6** (o TypeScript 7 nativo ainda não é suportado pelo typescript-eslint), ESLint 9,
  Vitest, Playwright (+ axe), fast-check.
- **Entrega**: o CI constrói duas imagens (`web`, `worker`) a partir do mesmo `Dockerfile`, testa a imagem
  com e2e, publica no GHCR (`:<sha>` e `:main`) e o workflow `deploy` chama a API do Dokploy.
  O Dokploy **não** builda (economiza RAM do VPS e garante que a imagem de produção é a testada).
- **Sem staging** até haver usuário real: produção usa os mesmos portões (CI, revisão, health check).

## Consequências

- O VPS só puxa imagens; builds pesados ficam no GitHub Actions.
- Rollback = reimplantar a tag `:<sha>` anterior (ver `docs/runbooks/rollback.md`).
- Requer GitHub Pro (ou organização Team) para rulesets/CODEOWNERS valerem em repositório privado.
- Ações do GitHub estão fixadas por major; Dependabot abre atualizações mensais agrupadas.
