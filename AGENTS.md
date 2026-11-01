# AGENTS.md — como trabalhar neste repositório

Instruções para agentes de código (Codex no Paperclip) e para humanos. Leia inteiro antes de mudar algo.
Idioma do produto, da UI, de commits e de comentários: **português do Brasil**.

## O que é

OrganizeUp: SaaS de gestão financeira pessoal e aposentadoria. Tenant = **household** (família).
Plano completo e fases: `docs/plano-mestre.md`. Decisões: `docs/adr/`.

## Mapa do repositório

| Caminho           | O quê                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `apps/web`        | Next.js 16 (App Router). UI pt-BR, Route Handlers (`/api/*`), Server Actions                     |
| `apps/worker`     | Worker pg-boss. No boot roda as migrações (credencial do dono) e processa filas                  |
| `packages/db`     | Schema Drizzle, migrações SQL, RLS, `withHousehold`, Ops helpers, migrador                       |
| `packages/domain` | Regras financeiras puras (decimal.js). Sem I/O                                                   |
| `packages/agents` | Agentes diários do produto: leem e gravam dentro do tx da família; usados pelo worker e pela web |
| `packages/ai`     | Assistente com IA: cliente, teto, instruções, ferramentas e loop. Só no servidor (ADR-0018)      |
| `docs/`           | ADRs, runbooks, custos, plano-mestre, specs                                                      |
| `paperclip/`      | Instruções da equipe de agentes do Paperclip. **Risco alto**                                     |
| `.github/`        | Lista de risco por caminho (CI desligado). **Risco alto**                                        |

## Comandos

```bash
pnpm install --frozen-lockfile
pnpm check            # lint + typecheck + unit + integração (RLS) — rode antes de abrir PR
pnpm test             # unit
pnpm test:integration # db (RLS) e agents, em sequência; sobe Postgres embutido (ou usa TEST_DATABASE_OWNER_URL)
pnpm db:local         # Postgres local persistente em 127.0.0.1:54329 com migrações
pnpm dev              # web em http://localhost:3000 (precisa de .env — ver .env.example)
pnpm dev:worker       # worker
pnpm format           # prettier
```

Produção é construída pelo Dokploy (`dokploy.home.crowntech.com.br`) a cada push em `main`. Não há CI nem
proteção de branch: `pnpm check` local é o único portão antes do push, e todo merge em `main` vai para
produção sozinho. Nunca crie nada no Dokploy `2.24.94.160` sem pedido do fundador.

## Regras invioláveis (a revisão bloqueia)

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
7. **Dado informado × dado derivado.** O que a família informou (valor e data da meta, categoria escolhida,
   custos de uma viagem, renda alvo, aporte digitado) só muda por **sugestão aceita na UI**. O que o sistema
   calcula a partir disso (plano mensal da meta, aporte sugerido, destino sugerido, projeção de aposentadoria,
   categoria de lançamento que ficou "para revisar" na importação) é **dado derivado**: o worker recalcula e
   sobrescreve todos os dias, e o relatório diário diz o que mudou. Toda alteração automática fica em
   `household_suggestions` com `status = 'aplicada'`, `applied_by = 'agente'` e o estado anterior no
   `payload`, com **Desfazer**. Desfazer bloqueia aquela alteração automática para sempre
   (`status = 'desfeita'`). Tool que altera dados só cria suggestion. Detalhes: ADR-0015 e ADR-0018.
8. **Risco alto** (`.github/**`, `AGENTS.md`, `Dockerfile`, `packages/db/**`, `packages/domain/**`,
   `paperclip/**` e auth; lista completa em `.github/workflows/risk-label.yml`) só muda quando a issue pede
   explicitamente, e exige a revisão reforçada do Revisor/QA. Não espera o fundador (ADR-0015).
9. **Agentes diários do produto** rodam no worker com `fromJob()` e `withHousehold()`, uma família por
   transação, um agente por transação; são idempotentes (rodar duas vezes no dia dá o mesmo resultado); só
   gravam dado derivado ou sugestão (regra 7); logam só id da família, agente e código do erro; para o schema
   `ops` enviam apenas contagens (`ops.agent_runs`). `DAILY_AGENTS_ENABLED=false` desliga todos. Chamada
   externa nunca dentro de `withHousehold`: cotações rodam no job de mercado (ADR-0017), e o modelo de IA só é
   chamado por `packages/ai`, depois de conferir consentimento e teto, com cada ferramenta na sua transação
   curta (ADR-0018).

## Fluxo de trabalho (agentes)

1. Leia a issue e o contexto: `GET /api/ops/context` (produção, relatórios, memórias, `agentRuns`) e
   `GET /api/ops/deployments`.
2. Crie um branch `agente/<issue>-<resumo>` a partir de `main`. Nunca faça push em `main`.
3. Implemente com testes. Rode `pnpm check`. Commits pequenos, mensagem em português no imperativo
   (`corrige ...`, `adiciona ...`). Nunca `--no-verify`, nunca force-push em branch compartilhado.
4. `gh pr create --fill --base main`. Cole a URL do PR na issue. Não há CI: `pnpm check` local verde é o
   portão, e o Revisor/QA repete em checkout limpo.
5. `pnpm check` vermelho: corrija no mesmo branch. Não desative testes, regras de lint ou checks.
6. O risco é definido pela lista de caminhos de `.github/workflows/risk-label.yml` (repetida em
   `paperclip/agentes/comum.md`), não por opinião. O Revisor/QA mescla qualquer risco sem esperar humano;
   em risco alto, faz antes a revisão reforçada de `paperclip/agentes/revisor-qa.md`. A única exceção é
   migração destrutiva (regra 3), que continua dependendo de ADR aprovado pelo fundador.
7. Depois do merge, confirme o deploy: `GET /api/health` deve mostrar o `commit` do merge (o SHA real, desde
   `c9f23d0`). Quando a versão adiciona coluna lida pelo layout da web, o worker sobe antes ou a web tolera
   `42703`/`42P01` até ele subir.

## UI

Mobile-first, acessível (rótulos ligados por `Field`, foco visível, contraste AA — o e2e roda axe).
Textos em português claro, sem jargão. Valores com `formatBRL`. Estados vazio/erro/carregando sempre.
Toda tela nova precisa de spec (campos, estados, primeiro uso) na issue antes de implementar.

## Testes

- Regras financeiras: fixtures com fonte citada + propriedades (fast-check) quando houver invariante.
- Isolamento: todo acesso novo a dados ganha caso no teste de RLS.
- E2E (`apps/web/e2e`): fluxos críticos do usuário; dados únicos por execução.
