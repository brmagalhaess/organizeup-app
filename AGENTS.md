# AGENTS.md — como trabalhar neste repositório

Instruções para agentes de código (Codex no Paperclip) e para humanos. Leia inteiro antes de mudar algo.
Idioma do produto, da UI, de commits e de comentários: **português do Brasil**.

## O que é

OrganizeUp: SaaS de gestão financeira pessoal e aposentadoria. Tenant = **household** (família).
Plano completo e fases: `docs/plano-mestre.md`. Decisões: `docs/adr/`.

## Mapa do repositório

| Caminho           | O quê                                                                           |
| ----------------- | ------------------------------------------------------------------------------- |
| `apps/web`        | Next.js 16 (App Router). UI pt-BR, Route Handlers (`/api/*`), Server Actions    |
| `apps/worker`     | Worker pg-boss. No boot roda as migrações (credencial do dono) e processa filas |
| `packages/db`     | Schema Drizzle, migrações SQL, RLS, `withHousehold`, Ops helpers, migrador      |
| `packages/domain` | Regras financeiras puras (decimal.js). Sem I/O                                  |
| `docs/`           | ADRs, runbooks, custos, plano-mestre                                            |
| `.github/`        | CI, risco por caminho, deploy. **Só o fundador altera**                         |

## Comandos

```bash
pnpm install --frozen-lockfile
pnpm check            # lint + typecheck + unit + integração (RLS) — rode antes de abrir PR
pnpm test             # unit
pnpm test:integration # sobe Postgres embutido (ou usa TEST_DATABASE_OWNER_URL)
pnpm db:local         # Postgres local persistente em 127.0.0.1:54329 com migrações
pnpm dev              # web em http://localhost:3000 (precisa de .env — ver .env.example)
pnpm dev:worker       # worker
pnpm format           # prettier
```

Produção é construída pelo Dokploy (`dokploy.home.crowntech.com.br`) a cada push em `main`. O GitHub
Actions está sem execução no momento, então `pnpm check` local é o único portão antes do push. Nunca crie
nada no Dokploy `2.24.94.160` sem pedido do fundador.

## Regras invioláveis (o CI e a revisão bloqueiam)

1. **Isolamento por household.** Dados de domínio só são lidos/gravados dentro de
   `withHousehold(ctx, tx => ...)` com `ctx` vindo de `fromSession()` (web) ou `fromJob()` (worker).
   Não existe `db` cru exportado; não importe `postgres` nem `@organizeup/db/auth-db` fora dos lugares permitidos.
2. **Tabela de domínio nova** = `household_id text NOT NULL`, `ENABLE` + `FORCE ROW LEVEL SECURITY`,
   políticas usando `app_household_id()` e `app_can_write()`, FK composta `(household_id, id)` para
   referências entre tabelas de tenant, e caso novo em `packages/db/test/rls.integration.test.ts`.
3. **Migrações** são arquivos novos `packages/db/migrations/NNNN_nome.sql` (próximo número). Nunca edite
   uma migração já mergeada (o migrador recusa por checksum). Só operações aditivas: proibido `DROP`,
   `ALTER ... TYPE` e renomear colunas sem ADR aprovado pelo fundador. Atualize o schema Drizzle no mesmo PR.
4. **Dinheiro** só com `packages/domain` (`money`, `toDbAmount`, `formatBRL`). Nunca `number` para valores.
   Banco: `numeric(14,2)`. Datas de vencimento: `date` no fuso do household.
5. **Sem PII fora do lugar.** Nada de dados pessoais em logs, no schema `ops`, em mensagens de erro, em
   issues/comentários do Paperclip ou em fixtures. Use dados fictícios (`@example.com`).
6. **Segredos** nunca no repositório. Novas variáveis: documente em `.env.example` e no runbook de bootstrap.
7. **IA no produto** (Fase 3+): tool que altera dados só cria `suggestion`; aplicar é ação do usuário na UI.
8. **Não altere** `.github/**`, `AGENTS.md`, `Dockerfile`, `packages/db/**`, `packages/domain/**` e auth
   sem que a issue peça explicitamente — esses caminhos exigem revisão do fundador (CODEOWNERS).

## Fluxo de trabalho (agentes)

1. Leia a issue e o contexto (`GET /api/ops/context` quando existir; hoje `GET /api/ops/deployments`).
2. Crie um branch `agente/<issue>-<resumo>` a partir de `main`. Nunca faça push em `main`.
3. Implemente com testes. Rode `pnpm check`. Commits pequenos, mensagem em português no imperativo
   (`corrige ...`, `adiciona ...`). Nunca `--no-verify`, nunca force-push em branch compartilhado.
4. `gh pr create --fill --base main`, depois `gh pr checks --watch`. Cole a URL do PR na issue.
5. CI vermelho: corrija no mesmo branch. Não desative testes, regras de lint ou checks.
6. O rótulo `risk:*` é automático. `risk:high` espera o fundador; `risk:low` pode ser mesclado pelo
   Reviewer/QA após CI verde.
7. Depois do merge, confirme o deploy: `GET /api/health` deve mostrar o `commit` do merge.

## UI

Mobile-first, acessível (rótulos ligados por `Field`, foco visível, contraste AA — o e2e roda axe).
Textos em português claro, sem jargão. Valores com `formatBRL`. Estados vazio/erro/carregando sempre.
Toda tela nova precisa de spec (campos, estados, primeiro uso) na issue antes de implementar.

## Testes

- Regras financeiras: fixtures com fonte citada + propriedades (fast-check) quando houver invariante.
- Isolamento: todo acesso novo a dados ganha caso no teste de RLS.
- E2E (`apps/web/e2e`): fluxos críticos do usuário; dados únicos por execução.
