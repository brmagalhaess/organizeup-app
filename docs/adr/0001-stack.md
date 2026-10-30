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
- **Entrega** (revisado em 2026-10-30, decisão do fundador): o GitHub só guarda o código. O Dokploy
  (`dokploy.home.crowntech.com.br`) puxa o branch `main` a cada push e constrói as duas imagens no próprio
  servidor, pelo mesmo `Dockerfile`, com `Docker Build Stage` = `worker` e `web`. O Dokploy em
  `2.24.94.160` não é mais usado para nada novo.
- **Sem staging** até haver usuário real.

## Consequências

- Antes de enviar para `main`, rode `pnpm check` localmente: o GitHub Actions da conta está sem
  execução (cobrança), então nenhum CI protege o push. Os workflows ficam no repositório para quando
  isso for resolvido, inclusive o `deploy.yml`, que hoje não é o caminho de deploy.
- Os builds consomem memória do servidor; há um limite de builds simultâneos no Dokploy e a fila é
  compartilhada com os outros projetos.
- `APP_COMMIT` fica `dev` em produção, porque o Dokploy não injeta o SHA no build. O commit implantado
  aparece na aba Deployments do Dokploy.
- Postgres fica no 17: a imagem do 18 não inicia com o volume em `/var/lib/postgresql/data`, que é onde o
  Dokploy o monta.
- Rulesets/CODEOWNERS exigem GitHub Pro (ou organização Team) em repositório privado.
