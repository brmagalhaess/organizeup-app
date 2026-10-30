# OrganizeUp — Plano-mestre (SaaS de gestão financeira pessoal e aposentadoria, operado por agentes)

## 1. Contexto

Você já tem dois sistemas OrganizeUP no ar (mesmo VPS Dokploy, IP 2.24.94.160):

| Sistema                                           | Stack observada                                                               | O que já faz                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **OrganizeUP Life (v1)** — `*.sslip.io/#overview` | React/Vite SPA + API `/api/*`, rotas hash                                     | perfil, família, aposentadoria/Arca, calendário, cashflows, investimentos + operações, objetivos **e viagens** (destino, quem vai, duração, orçamento sugerido), projetos, notificações ("análises e alertas dos agentes"), billing, admin (tenants, planos, campanhas Brevo, **revisão do sistema, execuções de código/patches, incidentes, workers com heartbeat**, autorização ChatGPT) |
| **organizeup.com.br (v2)**                        | HTML estático + Bootstrap + Chart.js, API Node (helmet, rate-limit), PWA, 2FA | dashboard, calendário, rendas CLT (13º, férias, reajuste, vigência), dívidas (snowball, anexos, arquivadas), Arca (carteira: ações/FIIs/internacionais/renda fixa, compra/venda, rebalanceamento), proventos (4 tipos) + metas, patrimônio, reserva, projetos, objetivos, membros, suporte, notificações, perfil, assinatura/premium, projeção, carteira sugerida                          |

O novo **OrganizeUp** é um código-base novo (não cópia) que junta o melhor dos dois e adiciona: **inteligência viva dentro do sistema** (assistente por household com memória e relatórios), **isolamento forte entre usuários**, e uma **equipe de agentes no Paperclip** que opera e evolui o sistema (monitora, corrige, abre PR → CI → deploy no Dokploy).

O plano passou por duas rodadas de revisão independente (segurança/multi-tenant, operação Paperclip+Codex+GitHub+Dokploy, domínio financeiro brasileiro, execução pragmática e completude); as correções confirmadas estão incorporadas abaixo.

### Decisões já fixadas com você

- Stack: **Next.js (major atual, versões fixadas) + Postgres**, monorepo TypeScript, Docker no Dokploy.
- Agentes de engenharia: **Paperclip no Dokploy, adapter `codex_local`** (Codex CLI já vem na imagem do Paperclip).
- IA dentro do app: **provedor configurável** (Claude por padrão, OpenAI alternativo).
- Repositórios antigos: você loga no GitHub no Chrome e eu leio pela extensão (ainda não estava logado ao escrever).

### Decisões recomendadas que dependem de você (confirme ou altere na aprovação)

1. **GitHub Pro** na sua conta (ou organização + Team): sem isso, rulesets, CODEOWNERS e Environments protegidos **não valem em repositório privado**.
2. **Conta-máquina `organizeup-bot`** (colaboradora do repo) como identidade dos agentes; sua conta fica só humana e única CODEOWNER.
3. **Sem ambiente de staging até existir usuário real**: prod serve de staging com os mesmos portões (CI, revisão, health check + rollback).
4. **Codex sem sandbox de escrita** (`engine: cli`, bypass padrão) se o teste da Fase 1 confirmar que o sandbox ACP impede `git commit` em worktree (é o que a documentação do Codex indica); compensado por credenciais mínimas e portões no GitHub.

### Informações que preciso de você (bloqueiam a Fase 1, não a Fase 0)

URL do Paperclip + token de board · URL do Dokploy + API key (usada só pelo CI, nunca por agentes) · usuário/organização GitHub + nomes dos 2 repos antigos · chave Anthropic · chave OpenAI (Codex) com limite de gasto no painel · Brevo SMTP (Fase 2) · bucket S3-compatível, Cloudflare R2 (Fase 3) · um canal de alerta pessoal (Telegram/ntfy).

---

## 2. Arquitetura

```
┌──────────────── GitHub (conta do fundador, Pro) ─────────────────────────┐
│ organizeup (monorepo; paperclip/ = export versionado da empresa)         │
│ main ──CI (build+test+e2e)──► GHCR ──API──► Dokploy prod                 │
│ rulesets + CODEOWNERS (fundador) + risk por paths + GITHUB_TOKEN read-only│
└──────────▲──────────────────────────────────────────────────────────────┘
           │ PRs da conta organizeup-bot (Codex)
┌──────────┴──────────────── VPS Dokploy ─────────────────────────────────┐
│ stack isolada "paperclip" (rede própria):      stack "organizeup":       │
│  Paperclip (authenticated, Postgres próprio)    web + worker (imagem CI)  │
│  Codex: Tech Lead, Engineer, Reviewer/QA, SRE   Postgres pgvector (sem    │
│  pg-agents (Postgres descartável, sem PII)      porta externa) · Kuma     │
│         └── só fala com o app pelo domínio público: /api/ops/* (sem PII) │
│ monitor externo → pagina o fundador · Sentry (digest via worker)         │
└──────────────────────────────────────────────────────────────────────────┘
```

Dois "mundos" de agentes, separados de propósito:

1. **Engenharia (Paperclip/Codex)** — opera o produto. Nunca vê dados pessoais nem credenciais de produção: só o repositório, a **Ops API** (`/api/ops/*`, agregados sem PII, pelo domínio público HTTPS), `pg-agents` para testes e relatórios.
2. **Assistente vivo (dentro do app)** — runtime próprio (Vercel AI SDK + Anthropic/OpenAI) com especialistas (Finanças, Aposentadoria, Investimentos, Viagens, Documentos, Calendário, Orquestrador), **sempre no contexto de um household**, com memória e relatórios no banco sob RLS. Premissa: **qualquer agente comprometido lê todos os secrets do Paperclip** (mesmo processo/UID) — por isso nada no Paperclip dá acesso a prod.

### Repositório `organizeup` (pnpm workspaces; Turborepo só quando houver >3 pacotes)

```
apps/web/            Next.js (App Router; Route Handlers = API; Server Actions); mobile-first, PWA (Fase 2)
  app/(marketing)/ (auth)/ (app)/ (admin)/ api/
  components/      kit com ~10 padrões (input monetário, date picker pt-BR, lista responsiva, estado vazio,
                   confirmação de sugestão) e helpers únicos de Intl pt-BR
apps/worker/         pg-boss (fila no Postgres, sem Redis): relatórios, extração de documentos, recorrências,
                     cotações/índices, e-mails, memória, digest do Sentry, snapshots, retenção
packages/db/         Drizzle + migrations (SQL custom para RLS) + roles; exporta SÓ withHousehold, withWorkerHousehold, adminDb
packages/domain/     regras puras (decimal.js, precisão/arredondamento fixados em ADR): CLT, dívidas, reserva,
                     aposentadoria, investimentos, viagens; __fixtures__ com fonte aprovada pelo fundador; fast-check
packages/ai/         (Fase 3) provedor configurável, tools por módulo, memória, prompts, evals (inclui injeção)
paperclip/           export versionado da empresa (COMPANY.md, agents/<slug>/AGENTS.md, skills/, tasks/, .paperclip.yaml)
docker/              Dockerfile (stages web, worker, migrate; ARG GIT_SHA → APP_COMMIT; inclui curl), compose de dev
.github/workflows/   ci.yml (lint, typecheck, unit, integração RLS, build, e2e contra a imagem), risk-label.yml
                     (pull_request_target, só lista de paths via API), deploy.yml (environment: production → Dokploy API)
.github/CODEOWNERS   fundador em .github/**, packages/db/**, packages/domain/**, auth, RLS, billing
AGENTS.md            convenções para o Codex: como rodar/testar, protocolo de issue→PR, proibições
docs/                ADRs (0001 stack, 0002 isolamento/auth, 0003 UI, 0004 dinheiro/arredondamento), runbooks
                     (deploy, rollback, restore, exclusão de conta, sem-agentes, fundador-ausente, cutover), custos.md
```

---

## 3. Modelo de dados (Postgres) — tenant = **household**

- **Auth (Better Auth, tabelas do adapter, sem RLS de tenant)**: `user`, `session`, `account`, `verification`, `twoFactor`; **household = plugin `organization`** (`modelName` household; roles owner|adult|child|viewer; `activeOrganizationId` → `app.household_id`), que já traz membros e convites.
- **Pessoas (Fase 0)**: `people` (household_id, nome, mês/ano de nascimento, relação, `user_id` nullable, dependente IR) — fonte da tela "família"; membros com login referenciam `people.id`. `person_id` (nullable = compartilhado) só nas tabelas inerentemente pessoais, quando nascerem: `income_sources` (F2), `retirement_plans`/`inss_profile`/`fgts` (F5), participantes de `trips` (F6). Nunca em threads/memórias.
- **Configurações**: `household_settings` (timezone default `America/Sao_Paulo`, moeda BRL, residência, base/aeroporto de viagem, viagens/ano, duração típica, perfil de risco, preferências); onboarding **mínimo** e progressivo por módulo.
- **Finanças (F2)**: `accounts` (type corrente|poupanca|investimento|dinheiro), `credit_cards` (`closing_day`, `due_day`, `paying_account_id`; ver ADR-0005), `categories` (copiadas de `category_templates` globais read-only; flag `essencial`), `cashflow_plans` (despesas/receitas recorrentes previstas), `income_sources` (type clt|pj_autonomo|aposentadoria_pensao|aluguel|outro, valor, `is_gross`, dependentes IR, descontos/benefícios jsonb, mês de férias, data-base, vigência; pj com contribuição INSS mensal), `fiscal_parameters` (inss|irrf|salario_minimo|teto_inss com vigência, seed revisado em janeiro), `transactions` (`import_fingerprint` único por conta: FITID do OFX ou hash; `installment_group_id/installment_no`), `installment_groups`, `credit_card_statements` (geradas pelo worker, entram no previsto pelo vencimento), `import_batches`, `debts` (taxa a.m., sistema price|sac|manual, nº parcelas, saldo; indexador/CET informativos) + `debt_installments` (**única** fonte dos lançamentos previstos de dívida), `assets` (patrimônio; `linked_debt_id`, `valuation_source`), `emergency_fund` (só a meta: meses × despesas essenciais), `earmarks` (posição/ativo → reserva|goal|aposentadoria|livre), `net_worth_snapshots` (mensal, worker). Valores `numeric(14,2)`, quantidades/índices `numeric(20,8)`, vencimentos `date`.
- **Investimentos (F4)**: `holdings` (kind equity|fii|etf_bdr|fixed_income|fund|pension; renda fixa/previdência com principal, indexador cdi|ipca|selic|prefixado, taxa, início, vencimento, liquidez, emissor, isenção, valorizadas por acúmulo de `index_series` com override manual), `trades` (com taxas no PM), `corporate_events` (split, grupamento, bonificação, subscrição, **amortização**), `dividends` (rendimento|dividendo|jcp; data-com, pagamento, bruto, IR retido), `quotes`, `index_series` (CDI, IPCA, SELIC, PTAX via BCB SGS; brapi.dev para B3), `rebalance_plans`, `suggested_portfolios` (educativo). Importação do extrato da Área do Investidor B3 como carga principal. IR de vendas/DARF fora do escopo.
- **Aposentadoria (F5)**: `retirement_plans` (por pessoa), `retirement_scenarios` com `assumptions` jsonb (inflação, retorno real por classe, taxa de retirada, idade-alvo, idade-limite, renda-alvo em R$ de hoje), `projection_snapshots` (scenario_id, hash das premissas, `engine_version`), `inss_profile` (valores informados pelo usuário a partir do simulador do Meu INSS), `fgts` (saldo + 8% do bruto CLT). Projeção soma INSS + FGTS + previdência + posições com earmark "aposentadoria"; termos reais por padrão.
- **Objetivos/viagens/calendário (F6)**: `goals` (travel|wish|purchase), `trips` + participantes, `calendar_events`, `projects`.
- **Documentos (F3)**: `documents` (R2), `document_extractions` (JSON + confiança), `suggestions` (toda alteração proposta pela IA; aplicada só por confirmação na UI).
- **IA por household (F3)**: `assistant_threads`, `assistant_messages`, `agent_memories` (kind, conteúdo, `source_message_id`, `confidence`, `superseded_by`, `expires_at`; FTS `portuguese`; `embedding` + `embedding_model/dim` só se a recuperação exigir), `household_reports` (único por `(household_id, kind, period)`), `ai_usage`.
- **Plataforma**: `plans`, `subscriptions` (F7), `notifications`, `support_tickets` (F2), `audit_log`, `access_logs` (IP/UA/ts, retenção 6 meses — Marco Civil), `feature_flags` (F3: kill switch de IA, `maintenance_mode`), `webhook_events`, `legacy_links` (F2+: ids antigos → novos).
- **Schema `ops` (sem PII)**: `ops.deployments` (commit visto pelo app no boot), `ops.diagnostics` (digest do Sentry: fingerprint, título, contagem, release, file:line; filas; jobs falhos), `ops.reports`, `ops.incidents`, `ops.agent_memory` (FTS), `ops.decisions`.

---

## 4. Isolamento e segurança do app (regra de ouro)

- `withHousehold(ctx, fn)` recebe um `TenantContext` tipado construído **só** por `fromSession(session)` (valida filiação ativa; devolve user/household/role) ou `fromJob(job)` (worker); abre transação curta e faz `set_config` de `app.household_id`, `app.user_id`, `app.role`. `packages/db` **não exporta** `db` cru — só `withHousehold`, `withWorkerHousehold`, `adminDb` (BYPASSRLS, pool próprio, auditado, 2FA do admin).
- Tabelas de domínio: `FORCE ROW LEVEL SECURITY` (migration SQL), política `household_id = current_setting('app.household_id', true)::uuid` (fail-closed), políticas de escrita por `app.role` (owner|adult). Tabelas do Better Auth ficam fora da RLS de tenant (documentado no ADR-0002).
- **FKs compostas `(household_id, id)`** em toda referência tenant→tenant (checagens de FK ignoram RLS). Templates globais (categorias, carteiras sugeridas) em tabelas próprias read-only, copiadas para o household.
- Transação **por operação/tool call**, nunca segurando conexão durante chamada ao LLM.
- Teste de isolamento no CI: dois households; leitura/escrita cruzada por API, por tool de IA, FK forjada e escrita por viewer/child — tudo deve falhar.
- Roles: `app_user` (web), `app_worker` (jobs), `app_admin`; serviço one-shot `migrate` cria/migra o schema `pgboss` (worker com `migrate: false`). Nenhum agente Paperclip acessa o banco de prod.

---

## 5. Assistente vivo (dentro do app) — Fase 3

- `packages/ai/provider.ts`: `claude` | `openai` (global e por household); modelos baratos para classificação/extração, fortes para análise; embeddings (se usados) de provedor nomeado (OpenAI ou Voyage — a Anthropic não oferece).
- Especialistas = personas + conjuntos de tools no mesmo runtime; cada um só tem tools do seu módulo.
- **Portão de mutação**: toda tool mutante só cria `suggestion`; o endpoint de aplicar recarrega a sugestão dentro de `withHousehold`, exige status pendente + owner|adult, re-valida o payload com zod e as FKs **no momento da confirmação**. Sem exceções por julgamento do modelo.
- **Saída**: texto extraído de documentos e campos livres são dados, nunca instruções (também ao gerar relatórios); links externos mostram domínio e pedem confirmação; CSP `img-src 'self' <R2>`; evals incluem casos de injeção e de exfiltração por markdown.
- **Memória**: extraída só de mensagens do usuário, com origem, confiança, TTL e substituição; tela "O que o assistente sabe sobre você" (editar/apagar); entra em exportar/apagar.
- **Relatórios**: gerados só para households ativos nos últimos 30 dias (ou sob demanda); plano grátis sem relatórios automáticos.
- **Custos/abuso**: caps duros independentes de plano (tokens/household/dia, `maxSteps`, timeout por tool, orçamento global mensal em env, kill switch), meta "custo de IA ≤ 20–25% do preço do plano" medida por `ai_usage`.
- **CVM**: sem recomendação individual de compra/venda; disclaimer em toda saída de investimentos; a feature chama-se "classes de ativos" (verificar marca "ARCA").

---

## 6. Equipe no Paperclip (empresa "organizerup")

### Ambiente (pré-requisito da Fase 1)

- Stack Compose própria no Dokploy com **Isolated Deployments** (rede própria), Postgres **dedicado** ao Paperclip (`DATABASE_URL`; o embutido é só para uso local), limite de memória; `PAPERCLIP_DEPLOYMENT_MODE=authenticated`, `PAPERCLIP_DEPLOYMENT_EXPOSURE=public` + `PAPERCLIP_PUBLIC_URL` HTTPS (ou `private` via Tailscale), `PAPERCLIP_SECRETS_STRICT_MODE=true`, `PAPERCLIP_AGENT_JWT_SECRET`, `BETTER_AUTH_SECRET`, `PAPERCLIP_SECRETS_MASTER_KEY` (com backup fora do bind mount); senha forte (não há 2FA). Porta 3000 do Dokploy fechada + ufw-docker; Postgres de prod sem porta externa.
- Clone em `/paperclip/workspaces/organizeup`; provision: `pnpm install --frozen-lockfile --prefer-offline` (store sob `PAPERCLIP_HOME`), `git config user.name/email` do bot; `gh` já vem na imagem; `pg-agents` descartável (sem PII) para `pnpm test` dentro do container — **build e e2e só no CI**. Fase 1 com checkout primário, "Shared workspace concurrency = Serialize", 1 run simultâneo por agente; worktrees isolados (experimental) só na etapa 2.
- **Passo 0 da Fase 1**: "Test Environment" + issue-fumaça que exige `git commit`, `git push`, `gh pr create`. Se o sandbox ACP bloquear (`.git` é read-only em workspace-write), usar `engine: cli` com bypass padrão (decisão 4).
- Backups: Postgres do Paperclip + `PAPERCLIP_HOME` + master key na rotina diária.

### Identidades e credenciais

- **GitHub**: conta-máquina `organizeup-bot` com PAT (classic `repo` se o repo é pessoal; fine-grained se em organização), expiração ≤ 90 dias, injetado como `GH_TOKEN`/`GITHUB_TOKEN` via `secret_ref`. Fundador = único CODEOWNER, conta só humana.
- **Ops API**: token por agente, hasheado, com escopos (`ops:read`, `memory:write`), expiração e revogação; limites de tamanho; regex best-effort de e-mail/CPF/UUID.
- **Codex**: `OPENAI_API_KEY` só via `secret_ref`, com limite de gasto no painel OpenAI = orçamento de empresa no Paperclip; orçamento mensal por agente com pausa automática; `outputInactivityTimeoutMs` curto. No primeiro run confirmar que o custo aparece precificado (senão o orçamento não protege).
- **Não recebem**: API key do Dokploy, credenciais do banco, Anthropic, Brevo, R2, token do Sentry.

### Agentes por etapa

| Etapa | Agente                                                                 | Papel                                                                                                                                                                                                                        | Acorda por                                                                                |
| ----- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1     | **Tech Lead**                                                          | quebra épicos em issues com `executionPolicy` (review = Reviewer/QA, approval = Tech Lead, `maxReviewRounds` 3, `responsibleUserId` = fundador), mantém `AGENTS.md`/ADRs, converte digest de suporte em issues               | atribuição + 1 cron diário                                                                |
| 1     | **Engineer**                                                           | implementa em branch; `gh pr create` → `gh pr checks --watch` → move issue para done (vira in_review)                                                                                                                        | atribuição                                                                                |
| 1     | **Reviewer/QA**                                                        | revisa; `gh pr merge --squash --delete-branch`; comenta o SHA; aprova a stage; fecha a issue                                                                                                                                 | reatribuição pela review stage                                                            |
| 1     | **SRE**                                                                | investiga alertas: `/api/ops/diagnostics` (digest do Sentry gerado pelo worker), `/api/ops/deployments`; abre incidente/issue; propõe PR de `git revert`; pode acionar `maintenance_mode` pela Ops API                       | webhook **bearer** do Uptime Kuma (encerra sem ação quando `status = UP`) + 1 cron diário |
| 2     | **CEO (Diretor)** · **Gestor de Agentes (RH)**                         | prioridades/metas; RH **cria** (`POST /agent-hires` → aprovação do board, `requireBoardApprovalForNewAgents` ligado), ajusta, pausa e **encerra** (`/terminate`) agentes via API e versiona `company export` em `paperclip/` | cron diário / semanal — só quando houver receita                                          |
| 3     | Segurança & Privacidade · Produto & Domínio · Release · Docs & Memória | rotinas semanais                                                                                                                                                                                                             | quando houver receita                                                                     |

"Heartbeat on interval" desligado em todos; só atribuição, webhook e os crons acima. Paperclip (UI/API) é a fonte da verdade; `paperclip/` é o export versionado (import só no bootstrap, com checklist pós-import: cwd, secrets, URL+segredo do webhook no Kuma, orçamentos, despausar, hiring policy).

### Memória dos agentes de engenharia

Skill `organizeup-ops-context`: em todo heartbeat `GET /api/ops/context?agent=<slug>` (relatórios, incidentes, memórias do agente por FTS, convenções) e ao terminar `POST /api/ops/memory` (com `source_issue`); tolera Ops API fora do ar usando `AGENT_HOME` + skill bundled `para-memory-files` (única memória até a etapa 2). `ops.reports`: saúde diária, erros 24h, custos de IA/Codex, métricas de produto, feedback estruturado (nota + categoria; texto livre só redigido por LLM barato e amostrado), resumo semanal.

---

## 7. Pipeline CI/CD (portões reais)

1. Alerta (Kuma → webhook bearer; Sentry → digest diário) ou rotina → issue → Tech Lead atribui.
2. Engineer → PR da conta bot. **CI builda a imagem única** (`docker/build-push-action`, tags `ghcr.io/<owner>/organizeup:<sha>` e `main`), roda lint/typecheck/unit/integração RLS/e2e contra a imagem + Postgres service.
3. `risk-label.yml` (`pull_request_target`, sem checkout do PR) calcula risco pelos paths; check falha se `.github/**` mudou e o autor não é o fundador. CODEOWNERS exige o fundador em `.github/**`, `packages/db/**`, `packages/domain/**`, auth, RLS, billing.
4. Ruleset de `main`: PR obrigatório, check `ci` obrigatório, aprovações gerais = 0, **require code owner review**, sem force-push, sem bypass para o bot. Risco baixo: Reviewer/QA faz merge após a review stage; risco alto: review do fundador.
5. `deploy.yml` (`environment: production`, branch `main`, único lugar com `DOKPLOY_API_KEY` e credencial GHCR) chama `POST /api/application.deploy`; Applications `web` e `worker` com Source Type **Docker** (auto-deploy do Dokploy desligado); `/api/health` devolve `{commit, uptime}`; o app grava `ops.deployments` no boot; health check Swarm com `curl -f` + `FailureAction: rollback`; `pg_dump` antes de migration; migrations de agentes só aditivas (lint bloqueia `DROP`/`ALTER TYPE`).
6. Regressão: SRE abre PR de `git revert`; rollback humano = redeploy da tag `:<sha>` anterior. `GITHUB_TOKEN` read-only por padrão; nenhum secret de prod fora do Environment `production`.

---

## 8. Transversais

- **Custos (`docs/custos.md`, Fase 0)**: tabela mensal (VPS, OpenAI do Codex, Anthropic, GitHub Pro, Sentry, Brevo, R2, domínio) e tetos; hipótese de preço e nº de households pagantes que cobre o fixo, fechada antes da Fase 3.
- **Observabilidade**: pino, Sentry (`sendDefaultPii: false`, sem body/cookies/headers, `beforeSend` scrubbing, sem `setUser` com e-mail) desde a Fase 1; Uptime Kuma no VPS + **monitor externo** paginando o fundador (Telegram/ntfy) para queda total; status page pública (Kuma).
- **Backups**: Database Backups do Dokploy para R2 (cron diário) + `pg_dump` cifrado no cliente (`age`), token R2 restrito ao bucket; teste de restore mensal; inclui Paperclip.
- **LGPD/legal**: exclusão em dois níveis — household (cascade) e **usuário** (pseudonimizar, apagar mensagens/memórias/consentimentos/sessões próprios); owner não exclui household com membros ativos sem transferir; apagar documentos remove todas as versões no R2 (lifecycle expira versões antigas); crianças com dado mínimo (mês/ano) e aviso ao responsável; step-up 2FA + owner para exportar/apagar/convidar; Termos de Uso + política de privacidade (encarregado = fundador; operadores internacionais) **antes do primeiro convite** (Fase 2); `access_logs` 6 meses; RIPD curto para a IA (F7); pessoa jurídica/CNAE/NFS-e/gateway como pré-requisito explícito da Fase 7.
- **Brasil/dinheiro**: fuso por household, `date` para vencimentos, decimal.js com precisão/arredondamento em ADR-0004, BCB SGS + brapi.dev atrás de interface única (`source`, `as_of`, override manual), feriados B3, OFX tolerante (ISO-8859-1/SGML), CPF cifrado (pgcrypto) e fora de logs.
- **Fórmulas**: fixtures com fonte (Calculadora do Cidadão, tabelas da Receita) aprovadas pelo fundador; invariantes com fast-check; `engine_version` nos snapshots; suíte de paridade com casos anonimizados do v2 antes da Fase 8.
- **UX (ADR-0003)**: mobile-first com navegação inferior, PWA instalável na Fase 2, kit de componentes, toda issue de UI traz spec de tela (campos, estados, vazio, erro, primeiro uso), `@axe-core/playwright` nas telas principais.
- **Resiliência humana**: runbooks `sem-agentes.md` (merge manual, deploy pelo CI, re-tag, pausar agentes e revogar PAT em dois comandos) e `fundador-ausente.md` (acesso de emergência a pessoa de confiança, segundo meio de pagamento, alertas de cobrança); `maintenance_mode` (somente leitura + banner).
- **Jobs/webhooks**: pg-boss com `jobId` determinístico, retries com backoff, dead-letter no admin; webhooks com assinatura verificada + `webhook_events`.

---

## 9. Fases (uma aprovação = começamos a Fase 0)

### Fase 0 — Esqueleto andante (pequena de propósito)

1. Pedir a pasta do projeto (request_directory), criar o repo `organizeup`, propor branch inicial.
2. Monorepo + Next.js (major atual) + TS estrito + Tailwind/shadcn + Drizzle + Postgres (pgvector) + pg-boss + zod env + Vitest + Playwright + ESLint/Prettier + decimal.js.
3. Better Auth (e-mail/senha; plugin `organization` = household com roles), `people`, `household_settings` mínimo, `audit_log`; **uma** tabela de tenant de exemplo com RLS completa (`withHousehold`, roles, FK composta) e o **teste de dois households no CI**.
4. Dockerfile (web/worker/migrate, `curl`, `APP_COMMIT`), `ci.yml` + `risk-label.yml` + `deploy.yml`, GHCR, ruleset de `main` + CODEOWNERS (requer GitHub Pro), Dokploy prod: stack `organizeup` (Applications web/worker via imagem, Postgres sem porta externa), `/api/health` com commit, `ops.deployments`.
5. `AGENTS.md`, ADR-0001 (stack), ADR-0002 (isolamento/auth), ADR-0003 (UI), ADR-0004 (dinheiro), `docs/custos.md`, runbooks de deploy/rollback/restore.
   Critério de pronto: login → criar household → gravar e ler na tabela de exemplo em prod; CI verde; `GET /api/health` mostra o SHA do último merge.

### Fase 1 — Paperclip operacional (prova o ciclo)

Pré-requisitos: ambiente Paperclip (seção 6), Sentry, Uptime Kuma + monitor externo, conta-máquina, chaves. Passo 0 (sandbox/commit). Agentes **Tech Lead, Engineer, Reviewer/QA, SRE** + skills (`organizeup-ops-context`, `organizeup-dev-workflow`, bundled `github-pr-workflow`, `qa-acceptance`, `issue-triage`, `para-memory-files`), rotina do SRE com webhook bearer, orçamentos. **Issue de teste fixa**: "adicionar `uptime` ao `/api/health`". Critério de pronto: issue → PR → CI verde → review stage → merge em `main` → deploy → SRE confirma `GET /api/ops/deployments == SHA` e o custo do run aparece precificado.

### Fase 2 — Núcleo financeiro

Inventário dos sistemas antigos (assim que o GitHub estiver logado: engine, schema, nº de usuários, hash de senha, TOTP, anexos, assinantes/gateway, listas Brevo, sobreposição de e-mails v1×v2) → `docs/legacy-inventory.md`. Convites, onboarding progressivo, Brevo SMTP, Termos/Privacidade, `support_tickets`, exportar/apagar conta, `access_logs`, PWA. Receitas (`income_sources`, `fiscal_parameters`, CLT bruto→líquido, 13º, férias) e despesas, categorias automáticas, cartão/faturas/parcelas, importação CSV/OFX idempotente, dívidas (`debt_installments`, snowball/avalanche), reserva (meta) + `earmarks`, patrimônio + `net_worth_snapshots`, calendário de vencimentos, dashboard mensal, importador de dados legados deste módulo (`legacy_links`).

### Fase 3 — Assistente vivo + memória + documentos

`packages/ai`, `feature_flags` (kill switch), R2, chat com especialistas e tools, portão de sugestões, memória por household (FTS), `household_reports`, upload → extração → sugestões, Central de notificações/insights, caps de custo, tela de memória, evals (inclui injeção). Hipótese de preço fechada antes de começar.

### Fase 4 — Investimentos e proventos

`holdings` por kind, trades com taxas, `corporate_events`, proventos com IR retido, cotações/índices, rebalanceamento, carteira sugerida (educativa), importação B3, especialista com disclaimers, importador legado.

### Fase 5 — Aposentadoria

Cenários com premissas explícitas, snapshots versionados, INSS informado (Meu INSS), FGTS, previdência (`kind=pension`), projeção real/nominal, relatório e especialista, importador legado.

### Fase 6 — Objetivos, viagens e calendário inteligente

Goals, participantes por pessoa, planejamento anual de viagens pelas configurações, orçamento por família/destino/duração, eventos e lembretes, especialista de viagens, importador legado.

### Fase 7 — Plataforma

Pré-requisitos: pessoa jurídica/CNAE, NFS-e, gateway (Stripe ou nacional). Planos/assinatura, 2FA TOTP, campanhas de e-mail, push, admin completo, RIPD, agentes das etapas 2–3 do Paperclip.

### Fase 8 — Migração e cutover

`legacy-inventory` → importadores ensaiados contra dump anonimizado com reconciliação (contagens/somas por household); import de hashes bcrypt; runbook de cutover (comunicar → v1/v2 somente leitura → import final → verificação → DNS de organizeup.com.br com TTL baixo → página de redirecionamento no sslip.io → 2FA re-enrolada → backups antigos 30 dias → desligamento); lista do que não migra.

---

## 10. Verificação

- CI em cada PR: lint + typecheck + unit (`packages/domain`, fixtures com fonte) + integração (RLS, dois households, FK forjada, papéis) + build da imagem + e2e Playwright (com axe) contra a imagem.
- Deploy: merge em `main` → CI → GHCR → Dokploy API → `GET /api/health` 200 com o SHA → `ops.deployments`; health check do Swarm reverte deploy quebrado.
- Paperclip (Fase 1): passo 0 de sandbox/commit aprovado; issue de teste fecha o ciclo completo; custo precificado; alerta simulado no Kuma acorda o SRE uma vez (não na recuperação).
- Restore: backup do dia restaurado num Postgres vazio antes de liberar a Fase 2.
- IA (Fase 3): `packages/ai/evals` (extração, categorização, estimativa de viagem, recusa CVM, injeção/exfiltração) com casos fixos.

## 11. Referências consultadas

Paperclip: agentes/heartbeats e wakeups, API de agentes (`agent-hires`, `wakeup`, `terminate`, `permissions`), issues/checkout/documents/executionPolicy, adapter Codex (engine ACP × CLI, sandbox, `instructionsFilePath`, `OPENAI_API_KEY` por secret, `CODEX_HOME`), rotinas (cron, webhook `bearer`/`hmac_sha256`), workspaces isolados (experimental), export/import (`--collision`), skills bundled, hiring policy, modos de deploy (`authenticated`/`public`), variáveis de ambiente, Docker (imagem com `codex` e `gh`), how-to GitHub (PAT ligado a usuário, sem webhook de merge). Codex: `.git` read-only em workspace-write. Dokploy: build no CI + Source Type Docker + `application.deploy`, Isolated Deployments, rollback (Swarm/registry) só para Applications, Database Backups, ufw-docker. GitHub: autor não aprova o próprio PR; rulesets/CODEOWNERS em repo privado exigem Pro/Team.
