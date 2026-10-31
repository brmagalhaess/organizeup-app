# Especificação — agentes diários, metas, cadastro complementar e admin (v2)

Pedido do fundador em 2026-10-31; v2 depois da revisão de quatro críticos (isolamento, finanças,
produto, completude). Esta especificação guia a implementação; as decisões duráveis vão para o
ADR-0015 (agentes diários e automação da equipe) e o ADR-0016 (metas, cadastro complementar e
admin). Tudo em português do Brasil. Dinheiro só com `@organizeup/domain`. Nenhum dado de família
sai do banco da família (RLS); para a equipe de engenharia só contagens. Na UI a palavra é sempre
**assistente**; "agente" fica em código, ADR e Paperclip.

## 0. Decisões que mudam regras anteriores

1. **Regra 7 reescrita (dado derivado × dado informado).** O que a família informou (valor e data
   da meta, categoria escolhida, custos de uma viagem, renda alvo, aporte digitado) só muda por
   **sugestão aceita na UI**. O que o sistema calcula a partir disso (plano mensal da meta, aporte
   sugerido, destino sugerido, projeção de aposentadoria, categoria de lançamento que ficou "para
   revisar" na importação) é **dado derivado**: o worker recalcula e sobrescreve todos os dias, e o
   relatório diário diz o que mudou. Toda alteração automática fica em `household_suggestions` com
   `status = 'aplicada'`, `applied_by = 'agente'` e o estado anterior no `payload`, com **Desfazer**.
   Desfazer bloqueia aquela alteração automática para sempre (`status = 'desfeita'`).
2. **ADR-0014 parcialmente substituído.** Aposentadoria planejada por **renda de proventos**
   (carteira perpétua). O cenário por consumo de patrimônio continua como comparação, dobrado em
   `<details>`. Estimar custo de destino entra com tabela global de referência cuja **cada linha cita
   fonte real e data** e um nível de confiança; linha sem fonte não entra.
3. **Equipe do Paperclip.** Rotina diária de revisão do sistema. PRs de **risco baixo** são
   mesclados pelo Revisor/QA sem humano. Caminhos de **risco alto** continuam esperando o fundador:
   não há CI nem proteção de branch, e um erro ali vai para produção sozinho. O fundador pode
   remover essa reserva com uma linha no ADR-0015.
4. **Sem modelo de IA** nos agentes do produto (ADR-0013) e **sem cotação externa** (ADR-0012).
5. **Exceção única à regra 3:** a migração 0016 troca a CHECK `household_reports_kind_check` (DROP
   CONSTRAINT + ADD CONSTRAINT) para aceitar os novos tipos de relatório. Autorizado pelo ADR-0015;
   o cabeçalho do SQL cita isso.

## 1. Banco — migração `0016_agentes_metas_perfil.sql` (+ Drizzle, export, grants, RLS test)

Padrão RLS idêntico a `0015_viagens.sql`. FK composta `(household_id, id)`. Tudo aditivo (exceto a
decisão 0.5). Confirmar o nome da constraint com `\d household_reports` no Postgres local antes de
escrever o DROP.

### 1.1 Colunas novas

`household_settings`:

- `retirement_year smallint CHECK (1950..2150)`; `trips_per_year smallint NOT NULL DEFAULT 0 CHECK
(0..12)`; `trip_days smallint CHECK (1..60)`.
- `wedding_day smallint CHECK (1..31)`, `wedding_month smallint CHECK (1..12)`, `wedding_year
smallint CHECK (1900..2100)` (dia é opcional e só serve para o lembrete anual; justificar no
  ADR-0016 como exceção ao dado mínimo, igual a `calendar_events.event_date`).
- `wedding_event_id text` FK composta → `calendar_events` `ON DELETE SET NULL (wedding_event_id)` —
  criado **pela família** no cadastro complementar/configurações, nunca pelo agente.
- `onboarding_version smallint NOT NULL DEFAULT 0`, `onboarding_completed_at timestamptz`.

`people`: `work_status text CHECK IN ('clt','pj_autonomo','servidor','aposentado','estudante',
'sem_renda','outro')`, `inss_contributor boolean`, `expected_pension numeric(14,2) CHECK (>= 0)`,
`retirement_age smallint CHECK (40..100)`. Quando `household_settings.retirement_year` é null, o
plano usa `min(birth_year + (retirement_age ?? 65))` entre pessoas `titular|conjuge` com nascimento.

`transactions.category_source text CHECK IN ('familia','importacao','revisar','agente')` nullable.
Quem grava: `saveEntry` → `familia`; `commitImport` → `familia` se a família corrigiu, `revisar` se
caiu no fallback, `importacao` nos demais; `applySuggestion`/`undo` → `familia`; agente → `agente`.
Lançamentos antigos (NULL) com `import_batch_id` preenchido e categoria fallback contam como
`revisar`; NULL sem lote conta como `familia`.

`emergency_fund.contribution numeric(14,2) CHECK (>= 0)` nullable — aporte mensal planejado para a
reserva. **`monthly_amount` é o gasto essencial informado: não tocar.**

`audit_log`: policy aditiva `audit_log_select_system` (SELECT para `app_role() = 'system' AND
current_user = 'ou_worker'`), com caso no teste de RLS. (Usada só para leitura de contexto; o filtro
de família ativa não depende dela — ver §3.)

### 1.2 Tabelas novas (RLS completa, exceto onde dito)

`retirement_plan` (1:1, `household_id` PK, sem policy DELETE): `target_income numeric(14,2) CHECK
(> 0)` null = derivar; `expected_yield numeric(5,2) CHECK (0 < x <= 30)` null; `dividend_growth
numeric(5,2) NOT NULL DEFAULT 0 CHECK (-5..15)`; `monthly_contribution numeric(14,2) CHECK (>= 0)`
null = usa o sugerido; `updated_at`.

`goals`: `id`, `household_id`, `name text CHECK (1..80)`, `kind text CHECK IN
('veiculo','imovel','reforma','educacao','compra','evento','outro')`, `target_amount numeric(14,2)
CHECK (> 0)`, `saved numeric(14,2) NOT NULL DEFAULT 0 CHECK (>= 0)`, `desired_month char(7)` null,
`priority smallint NOT NULL DEFAULT 3 CHECK (1..5)`, `status text NOT NULL DEFAULT 'planejando'
CHECK IN ('planejando','juntando','concluida','pausada')`, `plan_day smallint NOT NULL DEFAULT 5
CHECK (1..28)`, `account_id text` FK composta → accounts `ON DELETE SET NULL (account_id)` (de onde
sai a parcela), `destination_account_id text` FK composta → accounts `ON DELETE SET NULL
(destination_account_id)` (onde o dinheiro fica, opcional), derivados `plan_start char(7)`,
`plan_end char(7)`, `plan_monthly numeric(14,2)`, `plan_note text CHECK (<= 400)`,
`plan_updated_at timestamptz`, `created_by`, `created_at`, `updated_at`; `UNIQUE (household_id, id)`.

`goal_contributions`: `id`, `household_id`, `goal_id` FK composta → goals CASCADE, `month char(7)`,
`amount numeric(14,2) CHECK (> 0)`, `transaction_id text` FK composta → transactions `ON DELETE SET
NULL (transaction_id)`, `created_at`; `UNIQUE (household_id, goal_id, month)`, `UNIQUE (household_id,
id)`.

`household_suggestions`: `id`, `household_id`, `agent text CHECK (~ '^[a-z0-9-]{1,40}$')`, `kind
text CHECK IN ('categoria','fusao_categoria','aporte_reserva','aporte_divida','aporte_investimento',
'viagem','meta','investimento','lembrete')`, `title text CHECK (1..120)`, `body text CHECK (1..800)`,
`payload jsonb NOT NULL DEFAULT '{}'`, `status text NOT NULL DEFAULT 'pendente' CHECK IN
('pendente','aplicada','ignorada','desfeita')`, `applied_by text NOT NULL DEFAULT 'familia' CHECK IN
('familia','agente')`, `dedupe_key text NOT NULL CHECK (1..160)`, `created_at`, `decided_at
timestamptz`, `decided_by text`; `UNIQUE (household_id, id)`; **índice único parcial**
`CREATE UNIQUE INDEX household_suggestions_pending_dedupe ON household_suggestions (household_id,
dedupe_key) WHERE status = 'pendente'`; índice `(household_id, status, created_at DESC)` e
`(household_id, dedupe_key, status)`. Drizzle: `uniqueIndex(...).on(householdId, dedupeKey).where(sql\`status = 'pendente'\`)`;
upsert com `.onConflictDoUpdate({ target: [householdId, dedupeKey], targetWhere: sql\`status =
'pendente'\`, set: {...} })`.

`trip_destination_templates` (global, somente leitura; REVOKE INSERT/UPDATE/DELETE para app e worker
no migrador, como `category_templates`): `id text PK` (slug), `name text`, `country char(2)`,
`region text CHECK IN ('brasil_perto','brasil','america_sul','america_norte','europa',
'asia_oceania')`, `lodging_per_night numeric(14,2)` (acomodação para até 4 pessoas; +50% por pessoa
extra), `food_per_person_day numeric(14,2)`, `local_transport_per_person_day numeric(14,2)`,
`flight_per_person numeric(14,2)` (ida e volta, saída do Brasil), `min_days smallint`,
`kids_friendly boolean`, `best_months text` (ex. `'1,2,7,12'`), `source text NOT NULL` (referência
real + mês/ano, ex. "Painel de preços da plataforma X, consulta 10/2026" ou "tarifa média divulgada
pela ANAC, 2025"), `confidence text NOT NULL CHECK IN ('baixa','media')`, `position smallint`.
Seed: quantos destinos tiverem fonte verificável (meta 20–30, variados por região). Valores
arredondados à centena. Passeios **não** são estimados (linha para a família preencher).

`category_templates`: inserir `('d-metas','Metas e objetivos','despesa',false,90)`,
`('r-metas','Metas e objetivos','receita',false,90)`, `('d-aportes','Aportes e investimentos',
'despesa',false,91)`. `SYSTEM_TEMPLATES` em `packages/db/src/finance.ts` ganha os três (famílias
antigas recebem em `ensureFinanceDefaults`). Domain exporta `GOAL_CATEGORY = "Metas e objetivos"`,
`CONTRIBUTION_CATEGORY = "Aportes e investimentos"` ao lado de `CARD_CATEGORY`/`DEBT_CATEGORY`;
`KEYWORDS` ganha grupo `d-aportes` (corretora, aplicacao, aplic, tesouro, cdb, lci, lca, previdencia).

`household_reports.kind` → `CHECK (kind IN ('importacao','categorias','investimentos',
'aposentadoria','viagens','metas'))` (decisão 0.5). `period` dos agentes = `YYYY-MM-DD`.

`ops.agent_runs`: `day date`, `agent text`, `runs int NOT NULL DEFAULT 1`, `households int`, `ok
int`, `failed int`, `suggestions int`, `applied int`, `duration_ms int`, `finished_at timestamptz`;
`PK (day, agent)`. Upsert **substitui** as contagens e faz `runs = runs + 1`. GRANT INSERT, UPDATE
só para `ou_worker`.

`ops.admin_access`: `id bigint identity PK`, `at timestamptz NOT NULL DEFAULT now()`,
`admin_user_id text NOT NULL`, `action text NOT NULL CHECK (1..60)`, `target_household_id text`
null. GRANT INSERT para `ou_app`. Nunca guarda o texto da busca.

### 1.3 Pacote `packages/db`

- `jobs.ts`: `JOB_QUEUES.dailyAgents = "daily-agents"`.
- `ops.ts`: `recordAgentRun(day, agent, counts)` (upsert substituindo + `runs + 1`),
  `listAgentRuns(limit = 14)`, `hasAgentRunToday(day, agent)`, `recordAdminAccess({ adminUserId,
action, targetHouseholdId? })`.
- `wealth.ts`: `listActiveHouseholdIds(days = 60): Promise<string[]>` — famílias com algum membro
  com sessão atualizada nos últimos `days` dias (`household_member` ⋈ `session`, tabelas de auth,
  sem RLS). É o critério de "família ativa" do worker e do admin.
- `finance.ts`: `ensureCategory(tx, householdId, kind, name, essential): Promise<{ id; created:
boolean }>` — procura por `normalizeDescription(nome)` entre as categorias (desarquiva se achar
  arquivada), senão insere. Extraído de `importar/actions.ts` (que passa a usá-lo).
- `export.ts`: `retirement_plan`, `goals`, `goal_contributions`, `household_suggestions`.
- `client.ts`: `adminPool()` abre com `connection: { default_transaction_read_only: "on" }` e
  `max: ADMIN_DATABASE_POOL_MAX ?? 2`. Admin na web é **só leitura**.
- `admin.ts`: `adminHouseholdList({ limit, offset, q })` via `withAdmin("painel admin: famílias")`
  → `{ id, name, createdAt, members, lastSessionAt, onboardingVersion }` (nome e e-mail do responsável
  **não** vêm na lista; `adminHouseholdOwnerEmail(householdId)` devolve o e-mail de uma família só,
  ação explícita registrada em `ops.admin_access`). Busca `q`: nome (ILIKE) ou e-mail exato de um
  membro (retorna só aquela família).
- `rls.integration.test.ts`: casos para `retirement_plan`, `goals`, `goal_contributions`,
  `household_suggestions` (leitura isolada, update/delete alheio, FK composta, viewer não escreve),
  colunas novas, `audit_log_select_system`, worker (`system`) escreve em `goal_contributions` e
  `household_suggestions`, `trip_destination_templates` só leitura, upsert por índice parcial
  funciona (duas chamadas = uma linha pendente), `exportHousehold` cobre tudo.

## 2. Regras puras — `packages/domain`

Cabeçalho de módulo dizendo que é estimativa e qual ADR. Testes com fixture comentada (fonte) e
fast-check para invariantes. Taxas em % como string. `retirement.ts` passa a exportar
`monthlyRate`, `accumulationFactor`, `annuityFactor`.

### 2.1 `surplus.ts`

- `monthlySurplus(points: MonthPoint[], options?: { minMonths?: number }) → { average; median;
usable; months; basis: "media_mediana" | "mediana" | "sem_dados" }`: só meses fechados com algum
  lançamento. `usable` = `min(average, median)` com `months >= 6`; `median` com `3 <= months < 6`;
  `"sem_dados"` abaixo de 3 (zeros). O chamador monta `points` com `monthlySeries` **excluindo**
  transações das categorias `GOAL_CATEGORY` (despesa e receita) e `CONTRIBUTION_CATEGORY` e
  transações ligadas a `goal_contributions.transaction_id` — "o que você guarda não conta como
  gasto". Teste: série com despesa em Metas = série sem ela.
- `forecastSurplus(incomeMonthlyNet: string, plannedExpenses: string) → string` — usado quando
  `basis = "sem_dados"`: renda líquida típica (`monthlyNet` das `income_sources`, sem férias/13º)
  menos previsões recorrentes de despesa; `basis: "previsto"` na saída do chamador.
- `availableToAllocate(surplus: string, slackPercent = 10) → string` = `max(0, surplus × (1 −
slackPercent/100))`.

### 2.2 `allocation.ts`

`ALLOCATION_RULES = { slackPercent: 10, reserveShare: 0.5, debtShare: 0.7, retirementShare: 0.7,
goalsShare: 0.5, expensiveDebtMonthlyRate: "1.00" }` exportado (ADR e testes referenciam).

`suggestAllocation(input: { available; reserveMissing; expensiveDebtBalance; retirementRequired:
string | null; confirmedTripsMonthly }) → Allocation { reserve; debt; retirement; goalsBudget;
tripsBudget; shortfall; notes: string[] }`:

1. `reserve = min(reserveMissing, available × 0,5)`; `rest = available − reserve`.
2. Dívidas caras (saldo de dívidas ativas com `monthly_rate` > `expensiveDebtMonthlyRate` ou >
   taxa mensal do yield usado): `debt = min(expensiveDebtBalance, rest × 0,7)`; nota "quitar
   <dívida> rende mais que investir"; `rest −= debt`.
3. Aposentadoria: se `retirementRequired === null` → `retirement = "0.00"` e nota "complete o plano
   de aposentadoria para receber quanto guardar"; senão `retirement = min(retirementRequired, rest ×
0,7)`, nota quando não cabe ("com este valor a meta fecha em <ano>"). `rest −= retirement`.
4. `goalsBudget = rest × 0,5`; `tripsBudget = max(0, rest × 0,5 − confirmedTripsMonthly)`;
   `shortfall = max(0, confirmedTripsMonthly − rest × 0,5)` com nota. Viagens confirmadas são
   descontadas **uma vez**, aqui.
5. `available = 0` → tudo zero, nota "sem excedente nos últimos N meses".
   Invariantes: `reserve + debt + retirement + goalsBudget + tripsBudget + shortfallAbsorbido =
available`; nada negativo; ponto fixo (a saída de ontem como entrada dá a mesma saída);
   `retirementRequired === null ⇒ retirement === "0.00"`.

### 2.3 `dividend-retirement.ts`

Premissas (no cabeçalho e no ADR-0015): reais de hoje; proventos líquidos do imposto retido;
reinvestidos ao mesmo yield; preço acompanha os proventos; retorno real anual = `(1+y)(1+g) − 1`;
não prevê mudança de tributação.

`planDividendRetirement(input: { today; targetYear: number | null; targetIncome: string | null;
essentialMonthly: string; averageExpenses12: string | null; pensions: { amount: string;
ageAtTarget: number | null; retirementAge: number }[]; assets: { id; assetClass; value: string;
dividendsNet12: string; monthsHeld: number; firstDividendOn: string | null }[]; expectedYield:
string | null; dividendGrowth: string; contribution: string }) → DividendPlan`:

- `targetIncomeUsed = targetIncome ?? max(essentialMonthly × 1,2, averageExpenses12 ?? 0)`;
  `targetBasis: "informado" | "gasto_medio" | "essencial_120" | "sem_dados"`. Sem dados → `status =
"sem_dados"` (nada mais calculado).
- `otherIncome` = soma das `pensions` com `ageAtTarget >= retirementAge`; as demais vão para
  `pensionsLater: { amount; fromYear }[]` e nota "R$ X de INSS entra só em <ano>".
- `incomeGap = max(0, target − otherIncome)`; `currentIncome = Σ dividendsNet12 / 12`;
  `coverage` = 100 quando `incomeGap = 0`, senão `min(999, currentIncome / incomeGap × 100)`.
- Yield observado: base = ativos pagadores (`dividendsNet12 > 0`, classes acao|fii|etf_bdr|exterior).
  Para cada um: se `monthsHeld >= 12` → anual = `dividendsNet12 / value`; se `3 <= monthsHeld < 12`
  → `dividendsNet12 / value × 12 / monthsHeld` (anualizado); `< 3` fora da base.
  `observedYield = Σ proventos anualizados ÷ Σ value da base`; `yieldBasis: "observado_12m"` (todos
  ≥ 12 m) | `"observado_anualizado"` (algum < 12 m; dizer "baseado em N meses") | `"informado"` |
  `"sem_dados"`. Observado fora de [1%, 20%] → `yieldBasis = "suspeito"`, usa `expectedYield` se
  houver e marca `suspiciousAssets`. `yieldUsed` null → `status = "sem_yield"`.
- `incomeBase` = valor dos pagadores; `otherBase` = restante. `requiredPortfolio = incomeGap × 12 /
(yieldUsed/100)`; `portfolioGap = max(0, required − incomeBase − otherBase)` (premissa: outros
  investimentos migram para ativos pagadores; a tela mostra as duas linhas e a nota).
- `monthsToTarget: number | null` (null sem ano; 0 se já passou). `r_m = monthlyRate(((1+y)(1+g)−1)
× 100)`. `requiredContribution = portfolioGap / accumulationFactor(r_m, monthsToTarget)` quando
  `monthsToTarget > 0` (`"0.00"` quando `portfolioGap = 0`), senão null.
- Com o aporte **real** (`contribution`): `yearWithContribution` (primeiro ano em que fecha, teto 60
  anos, null se não fecha), `projectedIncomeAtTarget`, `series: { year; value; income }[]`.
- `status: "ok" | "sem_dados" | "sem_yield" | "sem_ano"`.
  Fixture: yield 6% a.a. ⇔ 0,4868% a.m.; renda alvo 6.000, outra renda 1.500 → gap 4.500 → carteira
  900.000. Fast-check: `requiredContribution` fecha em ≤ `targetYear`; `requiredPortfolio` cresce
  quando o yield cai; `coverage` nunca negativa.

`forecastDividends(rows: DividendInput[], from: YearMonth, months = 12) → { investmentId; month;
amount; basis: "mensal_12m" | "mesmo_mes_ano_passado" }[]`: ativo com pagamento em ≥ 9 dos últimos
12 meses → média líquida mensal em todo mês; senão repete o líquido do mesmo mês do ano anterior;
sem histórico → nada.

### 2.4 `goal.ts`

`planGoals(input: { today; planDayPassed: boolean; budget: string; goals: GoalInput[] }) →
GoalPlan[]`, `GoalInput { id; targetAmount; saved; desiredMonth: YearMonth | null; priority; status;
confirmedMonths: YearMonth[] }`, `GoalPlan { id; start: YearMonth | null; end: YearMonth | null;
monthly: string | null; months: number; onTime: boolean | null; note: string; contributions: {
month; amount }[] }`. `GOAL_RULES = { maxMonths: 120, minMonthlyPercent: 1 }`.

1. Ordena por `priority` e depois `desiredMonth` mais próximo. `pausada`/`concluida` sem plano;
   `saved >= target` → `concluida`.
2. `firstMonth = max(mês atual (+1 se planDayPassed), mês seguinte ao último confirmado)`.
3. `missing = target − saved`. Com `desiredMonth >= firstMonth`: `needed = missing / meses
(inclusive)`; cabe → `monthly = needed`, `onTime = true`; não cabe → `monthly = budgetLeft`,
   `onTime = false`, nota "não cabe no orçamento; termina em <end>". Com `desiredMonth <
firstMonth`: trata como sem prazo, `onTime = false`, nota "a data desejada já passou; nova
   previsão: <end>". Sem prazo: `monthly = budgetLeft`.
4. `months = ceil(missing / monthly)`. Se `months > 120` ou `monthly < 1% de missing` → sem
   parcelas, `end = null`, nota "com R$ X por mês levaria mais de 10 anos; reduza, adie ou aumente".
   Se `budgetLeft = 0` → `start` = mês seguinte ao `end` da meta anterior que libera orçamento e
   `monthly` = o valor liberado; nota "começa quando <meta> terminar".
5. Parcelas: `monthly` nos primeiros `n−1` meses, última = `missing − monthly × (n−1)`, **pulando
   `confirmedMonths`**. `plan_monthly` = `monthly`. `budgetLeft −= monthly`.
   Fast-check: soma das parcelas = `missing` quando `end` não é null; Σ `monthly` ≤ `budget`;
   `end >= start`; nenhum mês em `confirmedMonths`.

### 2.5 `trip-suggest.ts`

`suggestTrips(input: { today; tripsPerYear; tripDays: number | null; travelers: { personId;
ageYears: number | null }[]; tripsBudgetMonthly: string; destinations: DestinationTemplate[];
existingTripMonths: YearMonth[]; weddingMonth: number | null }) → TripSuggestion[]`:

- Viajantes = pessoas `titular|conjuge|filho`; `ageYears` null conta como adulto; criança < 12 →
  0,7 em alimentação/transporte, 1,0 em passagem; alguma criança → só `kids_friendly`.
- Dias = `tripDays ?? max(min_days, 5)`; noites = dias − 1. Custo: `hospedagem = lodging × noites ×
(1 + 0,5 × max(0, pessoas − 4))`; `alimentacao = Σ fator × food × dias`; `transporte = Σ fator ×
transport × dias`; `passagem = pessoas × flight`; `total` = soma.
- Orçamento anual = `tripsBudgetMonthly × 12`; por viagem = anual / `tripsPerYear`. Escolhe os
  `tripsPerYear` destinos mais caros que cabem, regiões diferentes entre si quando possível. Nada
  cabe → o mais barato com `fits: false` e nota "guarde R$ X a mais por mês".
- Meses: viagem k no primeiro mês `m_k ≥ max(4, ceil(Σ_{i≤k} total_i / tripsBudgetMonthly))`,
  preferindo `best_months` e evitando `existingTripMonths`; com `weddingMonth`, uma viagem cai no
  aniversário (do ano seguinte se faltam < 4 meses). `fits` = em nenhum mês a soma de
  `monthlyToSave` das sugeridas passa de `tripsBudgetMonthly`.
- Saída: `destinationId, name, month, days, personIds, estimated: { passagem; hospedagem;
alimentacao; transporte }, total, perPerson, monthlyToSave, fits, confidence, source, note`.
  Fast-check: `fits ⇒` soma mensal ≤ orçamento; meses distintos; quantidade ≤ `tripsPerYear`.

### 2.6 `categorize.ts` (ampliar)

- Exportar `KEYWORDS` (readonly), `isFallbackCategory(name)`, `GOAL_CATEGORY`, `CONTRIBUTION_CATEGORY`.
- `reviewCategories(input: { transactions: { id; kind; description; categoryId; categoryName;
categorySource: "familia" | "importacao" | "revisar" | "agente" | null; importBatchId: string |
null }[]; categories: CategoryOption[]; memory: CategoryMemory; blocked: Set<string> (dedupe_keys
'desfeita') }) → CategoryReview { automatic: ReviewGroup[]; suggested: ReviewGroup[] }`,
  `ReviewGroup { ids; merchant; fromCategoryId; toCategoryId: string | null; newCategory: { name;
essential } | null; reason; dedupeKey }`:
  - `memory.history` só com transações cuja categoria **não** é fallback; `memory.learned` só
    `category_memory` com `source = 'familia'` para decidir `automatic` (memória `agente` só gera
    `suggested`).
  - `automatic`: lançamentos `revisar` (ou NULL + lote + fallback) em categoria fallback cujo
    `categorizeRow` devolve `memoria|palavra|nova` com destino ≠ origem, e `dedupeKey ∉ blocked`.
  - `suggested`: mesmo merchant com ≥ 2 categorias nos últimos 90 dias → a mais frequente (memória da
    família vence); fallback com `category_source = 'familia'` → sugerido, nunca automático.
- `suggestCategoryMerges(categories: CategoryOption & { archived; template: boolean }[], usage: {
categoryId; count }[]) → { fromCategoryId; toCategoryId; reason }[]`: mesmo `kind` e
  `normalizeDescription` igual ou contido; ou categoria não-modelo com ≤ 3 usos em 90 dias cujo nome
  casa com `KEYWORDS` de outra existente. Destino = a mais usada. Nunca automático.
- `dailyCategoryReport(review, merges, counts) → { title; summary; data: ReportCategorias }`.

### 2.7 `cashflow.ts` / `wealth.ts`

- `MonthEntry.source` ganha `"meta"`; chave `g:<goalId>:<YYYY-MM>`.
- `NetWorthInput.goals: { id; saved; hasDestination: boolean }[]`; `owned` soma `saved` **só** das
  metas sem conta destino (com destino o dinheiro já está no saldo da conta). Linha "Guardado para
  metas" em `NetWorthSummary`.

## 3. `packages/agents` (novo workspace; depende de db e domain) e worker

`packages/agents/src/`:

- `suggestions.ts`: schemas zod dos payloads e `DEDUPE` helpers. Payloads:
  `categoria { transactionIds: string[] min 1; fromCategoryId; toCategoryId: string | null;
newCategory: { name max 60; essential } | null; merchant; previous?: { transactionId; categoryId;
categorySource }[] }`; `fusao_categoria { fromCategoryId; toCategoryId; transactionIds; planIds;
purchaseIds }`; `aporte_reserva { monthlyAmount: /^\d+\.\d{2}$/ > 0; previous: string | null }`;
  `aporte_divida { debtId; extraMonthly }`; `aporte_investimento { monthlyAmount; previous }`;
  `viagem { destinationId; name; month; days; personIds; estimated: { passagem; hospedagem;
alimentacao; transporte }; total; monthlyToSave; fits; confidence; source }`; `meta { goalId;
proposedMonth: YYYY-MM | null; extraMonthly: string | null }`; `investimento | lembrete { href;
investmentId? }`. Dedupe keys: `categoria:<kind>:<merchantKey>:<toCategoryId|new:<nome>>`,
  `fusao:<from>:<to>`, `aporte_reserva:<YYYY-MM>`, `aporte_divida:<debtId>:<YYYY-MM>`,
  `aporte_investimento:<YYYY-MM>`, `viagem:<destinationId>:<ano>`, `meta:<goalId>:<YYYY-MM>`,
  `investimento:preco:<id>:<YYYY-MM>`, `investimento:classe:<classe>:<YYYY-MM>`,
  `lembrete:aposentadoria`.
- `reports.ts`: tipos de `household_reports.data` por kind: `categorias { reviewed; moved;
created: string[]; pending; merges }`; `investimentos { total; cost; yield12: number | null;
dividends12; byMonth: { month; net }[]; stale: string[]; forecast: { month; amount }[] }`;
  `aposentadoria { plan: DividendPlan; allocation: Allocation; surplus }`; `viagens {
budgetMonthly; suggestions: TripSuggestion[]; confirmedNext12 }`; `metas { budget; goals:
GoalPlan[] }`.
- `inputs.ts`: `dividendPlanInputs(tx, { today })`, `surplusInputs(tx, { today })`,
  `reserveInputs(tx)` — leituras compartilhadas por worker e web.
- `run-categorias.ts`, `run-investimentos.ts`, `run-aposentadoria.ts` (→ `{ allocation, plan }`),
  `run-viagens.ts` (recebe `allocation`), `run-metas.ts` (recebe `allocation`): todos
  `(tx: TenantTx, input: { today; householdId; allocation? }) → AgentResult { suggestions; applied;
report: { title; summary; data } }`, sem I/O fora do `tx`. Cada um grava sugestões (upsert pelo
  índice parcial; não recria `ignorada` com `decided_at` < 30 dias; nunca aplica automático em
  `dedupe_key` com `desfeita`) e o relatório do dia (upsert por `(household_id, kind, period)`).
- `apply.ts`: `applySuggestion(tx, ctx, id)` / `undoSuggestion(tx, ctx, id)` com toda a lógica de
  aplicar por kind (usada pela web): recarrega, exige `pendente` (ou `aplicada` para desfazer),
  revalida payload com zod, executa, grava `decided_*`. `undo` de categoria só se
  `transactions.category_id` ainda for `payload.toCategoryId` (senão devolve mensagem "alguém já
  mudou esses lançamentos"); apaga `category_memory` do merchant com `source = 'agente'`; marca
  `desfeita`.
- `trips.ts`: `createTrip(tx, ctx, input: { destination; startOn; endOn: string | null; personIds;
costs: { kind; amount; perPerson }[] }) → { tripId; eventId }` (extraído de `viagens/actions.ts`,
  que passa a usá-lo).

Agentes (resumo do que cada um faz; detalhes de §2):

1. `categorias`: 90 dias de `transactions` → `reviewCategories` + `suggestCategoryMerges`.
   Automáticos: `ensureCategory` quando `newCategory`, `UPDATE transactions SET category_id,
category_source = 'agente'`, memória `source = 'agente'`, sugestão `aplicada`/`agente` com
   `previous`. Pendentes: `categoria` (sugeridos) e `fusao_categoria`.
2. `investimentos`: carteira, proventos, yield por ativo, `forecastDividends`; `valued_on` > 30 dias
   → `investimento` (preço); classe com desvio ≥ 10 pontos da meta → `investimento` informativo (sem
   ativo para comprar/vender).
3. `aposentadoria`: `surplusInputs` → `monthlySurplus`/`forecastSurplus` → `availableToAllocate`;
   reserva (`reserveStatus` com `emergency_fund.contribution`); dívidas caras; primeiro
   `planDividendRetirement` com `contribution = retirement_plan.monthly_contribution ?? 0` para obter
   `requiredContribution`, depois `suggestAllocation`, depois **recalcula** o plano com
   `contribution = monthly_contribution ?? allocation.retirement` (projeções com o aporte real).
   Sugestões: `aporte_reserva` (só > 0 e ≠ `emergency_fund.contribution`), `aporte_divida`,
   `aporte_investimento` (≠ `monthly_contribution`), `lembrete` quando `status ≠ "ok"`.
4. `viagens`: só com `trips_per_year > 0` → `suggestTrips` com `allocation.tripsBudget`; no máximo
   `trips_per_year` pendentes. **Não toca** `calendar_events`.
5. `metas`: `ensureFinanceDefaults` no início; `planGoals` com `budget = allocation.goalsBudget`,
   `planDayPassed` pelo `plan_day` da meta; apaga `goal_contributions` com `transaction_id IS NULL`
   (passadas e as fora do plano), upsert por `(goal_id, month)` só onde `transaction_id IS NULL`;
   atualiza `plan_*` e `status`; `plan_note` anota parcelas redistribuídas; sugestão `meta` quando
   não cabe/prazo passou. Meta sem `account_id` → sem parcelas, nota "escolha a conta de onde sai".

Worker (`apps/worker/src/daily-agents.ts` + `main.ts`): fila `daily-agents`, cron `0 4 * * *`
(America/Sao_Paulo); no boot `boss.send` só se `!hasAgentRunToday(hoje, "metas")`; `singletonKey =
"daily:" + hoje`. `DAILY_AGENTS_ENABLED=false` desliga. Para cada id de `listActiveHouseholdIds(60)`:
cinco `withWorkerHousehold` (um por agente), try/catch por agente, log só `householdId`, agente,
`err.code`; `allocation` passa em memória do 3 para 4 e 5 (se o 3 falhar, 4 e 5 leem
`household_reports(kind='aposentadoria', period=hoje).data.allocation` ou pulam). Ao final
`recordAgentRun` por agente.

Testes: `packages/agents/test/agents.integration.test.ts` com `vitest.integration.config.ts`
(`globalSetup: ["../db/test/global-setup.ts"]`, `include: test/**/*.integration.test.ts`,
`fileParallelism: false`, `hookTimeout: 180000`, `env.TEST_PG_PORT = "54349"`), `tsconfig`
incluindo `test`, `embedded-postgres` em devDependencies (mesma versão), seed via `withAdmin` +
`withWorkerHousehold`, `process.env.DATABASE_URL = urls.worker` antes do `await import`. Casos:
idempotência (duas rodadas = mesmas linhas), nada vaza para a família B, lançamento `familia` em
fallback não muda, parcela confirmada no mês atual não causa erro e não é duplicada, sugestão
`desfeita` não volta como automática. Root `package.json`: `"test:integration": "pnpm -r
--workspace-concurrency=1 test:integration"`; `pnpm check` segue chamando `test:integration`.

## 4. Web

### 4.1 Cadastro complementar — `/app/completar` (grupo `(inicio)`)

`ONBOARDING_VERSION = 1` em `src/lib/onboarding.ts` com `onboardingStatus(tx) → { version;
completedAt; pending }`. **Não muda** o redirecionamento de `create-household-form.tsx` (continua
`/app`; os 11 specs e2e ficam intactos). Convite acontece no painel: `FirstSteps` ganha como
**primeiro** item "Complete o cadastro da família" (hint "Aposentadoria, viagens e metas dependem
disso. Leva 3 minutos.", `checklist.onboarding` em `loadOverview`, "N de 5") e o banner do
`AppShell` (§4.3) para `canWrite(ctx)` enquanto `version < ONBOARDING_VERSION`.

Página chama `requireTenant()`; viewer/child veem Card "Só o responsável ou um adulto pode
completar o cadastro." Cabeçalho "Passo N de 4 · <título>" com `<progress value max
aria-label="Progresso do cadastro">`, link "Voltar ao painel", `loading.tsx`, formulários com
`submitKeeping` e `FormMessage`. Frase com link para a Política: "Esses dados ficam só na sua família
e servem para o plano de aposentadoria. Veja o que mudou."

1. **Sua família**: nascimento do titular (mês/ano, destaque), outras pessoas (nome, relação,
   nascimento), casamento (dia opcional, mês/ano opcionais; com dia → cria evento anual
   "Aniversário de casamento" e grava `wedding_event_id`). "Pular por agora" avança o passo.
2. **Aposentadoria**: ano em que querem parar (sugerido: titular aos 65 quando há nascimento),
   "Renda que você quer por mês" (hint "Vazio: usamos seu gasto médio"), "Rendimento anual da
   carteira (%)" (hint "Quanto a carteira paga em proventos por ano. Ex.: R$ 100 mil que pagam R$ 6
   mil = 6%."); por adulto, uma linha opcional: situação de trabalho, contribui para o INSS?,
   benefício mensal esperado (hint "Se não sabe, pule; dá para preencher depois em Família").
3. **Viagens**: quantas por ano (0–12) e quantos dias costumam durar.
4. **Primeira meta** (opcional) e botão **Concluir** (grava `onboarding_version = 1`,
   `onboarding_completed_at`, audit `onboarding`, `revalidatePath("/app","layout")`, vai para `/app`).
   `familia/`: pessoas com os campos novos (`addPerson`/`updatePerson` em `app/actions.ts` ganham
   `workStatus`, `inssContributor`, `expectedPension`, `retirementAge`); casamento editável.
   `configuracoes/`: seção "Plano" (ano, viagens/ano, dias; mesmos campos). Novo spec
   `apps/web/e2e/completar.spec.ts` (4 passos, banner some depois, axe em cada passo).

### 4.2 Metas — `/app/metas` (menu "Patrimônio", antes de Aposentadoria, ícone Target)

`lib/goals.ts` `loadGoals(ctx)`. Board: progresso com `role="progressbar"`, `StatTile`s
("Guardando por mês", "Próxima conquista"), `Sheet` com nome, tipo (Carro ou moto, Casa ou
apartamento, Reforma, Estudos, Compra, Festa ou evento, Outro), valor, "Quando quer ter conquistado"
(`type=month`, opcional), prioridade, "Dia do mês para guardar" (padrão `pay_day + 1` da maior
renda, senão 5), "De onde sai" (conta, obrigatório; padrão conta ativa mais antiga), "Onde o dinheiro
fica" (opcional). Actions `saveGoal`, `deleteGoal`, `setGoalStatus` (pausar/retomar),
`addSavedToGoal`, `replanNow` (= `withHousehold(ctx, tx => runMetasAgent(tx, { today, allocation:
lerDoRelatórioDeHoje }))`, com `pending` "Recalculando…" e `FormMessage` "Plano atualizado."). Card
sem plano: Badge warning "Sem espaço no orçamento" + "Hoje não sobra para esta meta. Reduza o valor,
adie a data ou pause outra meta." Texto do plano: "Guarde R$ X por mês de <mês> a <mês>" + nota.
Parcelas vencidas do mês anterior com botão "Confirmei". Vazio: "Qual é o próximo sonho da família?"
/ "Diga quanto custa e quando quer. O assistente calcula quanto guardar por mês e encaixa no seu
calendário." / "Criar meta". Rodapé: "O plano é recalculado todo dia quando suas receitas e despesas
mudam."

Calendário/lançamentos: `lib/commitments.ts` inclui `goal_contributions` sem `transaction_id` como
`ScheduledEntry { key: "g:<goal>:<month>", source: "meta", kind: "despesa", description: "Meta:
<nome> (k/n)", categoryId: systemCategories(tx).goal, accountId: goals.account_id, date:
occurrenceDate(plan_day, month) }` (meta sem conta → fora). `systemCategories(tx) → { card?; debt?;
goal?; goalIncome?; contribution? }`. `confirm-entry.ts` ramo `g:`: despesa na conta origem
(`d-metas`) e, com destino, receita de mesmo valor na conta destino (`r-metas`) na mesma transação;
liga `transaction_id`; `goals.saved += amount`; audit. `lancamentos/actions.ts deleteEntry`: ao
apagar transação ligada a `goal_contributions`, subtrai de `goals.saved`. `components/styles.ts`:
`confirmLabel(entry) → "Guardar" | "Receber" | "Pagar"` e `doneLabel → "Guardado" | "Recebido" |
"Pago"`, usados em `entries-table.tsx`, `calendar-board.tsx`, `(painel)/page.tsx`.
`SCHEDULED_PAGES.meta = "/app/metas"`, Badge "Plano" com `title="Valor calculado pelo assistente;
abra Metas para ajustar"`, `aria-label` "Abrir meta <nome>".

### 4.3 Sugestões — `/app/sugestoes` (menu "Dia a dia", logo após Painel, ícone Sparkles) e shell

`lib/suggestions.ts` `loadSuggestions(ctx)`, `countPending(tx)`. Actions (`sugestoes/actions.ts`):
`applySuggestion(form {id})`, `dismissSuggestion(form {id})`, `undoSuggestion(form {id})`,
`applyAll(form {kind})` — só `categoria`, `investimento`, `lembrete`, via `ConfirmSheet` ("Mover 12
lançamentos para as categorias sugeridas?"). Tudo delega para `packages/agents/apply.ts`. Página com
dois h2: **"Para você decidir"** (pendentes; botões "Aceitar" / "Agora não" com hint "Voltamos a
sugerir daqui a 30 dias"; viagem: "Adicionar às minhas viagens") e **"O que o assistente fez
sozinho"** (aplicadas por `agente` nos últimos 7 dias: "Movemos 4 lançamentos de ‘Outras despesas’
para ‘Mercado’" + "Desfazer"). Vazio: "Nada para revisar por enquanto" / "O assistente passa por
aqui toda madrugada e deixa aqui o que notar."

`AppShell` recebe `notice?: { key; text; href; linkLabel } | null` e `pendingSuggestions: number`.
Banner: `<section role="region" aria-label="Aviso" className="bg-warning-soft text-ink">` antes do
`<main>`, texto + `Link` ("Completar agora") + "Não mostrar mais" (action grava
`onboarding_version = ONBOARDING_VERSION`) + `IconButton label="Fechar aviso"` → server action
`dismissNotice(form {key})` grava cookie `ou_notice_<key>=1` até o fim do dia (fuso da família) e
`revalidatePath`. `(painel)/layout.tsx` lê `cookies()`, consulta `onboardingStatus` e `countPending`
em `try/catch` que trata `42703`/`42P01` como "sem aviso" (web pode subir antes da migração). Badge
de contagem no item de menu "Sugestões" (`<span aria-label="3 sugestões pendentes">3</span>`).
Painel (`/app`): cartão "Sugestões do assistente" com até 3 pendentes e link.

### 4.4 Aposentadoria, viagens, investimentos, proventos

- `aposentadoria/`: seção principal **"Viver dos rendimentos"** — "A carteira paga as contas e não
  acaba. Este é o plano que o assistente acompanha." `loadDividendPlan(ctx)` =
  `dividendPlanInputs` + `planDividendRetirement` + alocação do relatório de hoje. Mostra: renda
  alvo e base ("igual ao seu gasto médio"), renda atual em proventos e "já cobre X%", rendimento
  anual da carteira e base ("baseado em N meses" / "informado"), "quanto precisa ter investido" e o
  que falta (duas linhas: carteira que paga renda × outros investimentos, com a nota), **um** destaque
  "Guarde por mês: R$ X (R$ A na reserva + R$ B em investimentos)" com "Aceitar este valor", ano em
  que fecha com o aporte atual, "para fechar em <ano> seria preciso R$ X", INSS que entra depois,
  gráfico carteira × renda com `role="img" aria-label` + tabela `sr-only`; formulário do
  `retirement_plan` (renda alvo, rendimento esperado, aporte; crescimento em "Ajustes avançados").
  Texto fixo: "Estimativa. Proventos passados não garantem proventos futuros; nada aqui é
  recomendação de investimento." Vazio: "Complete seu plano de aposentadoria" (link para
  `/app/completar`) ou "Informe o rendimento anual da carteira ou registre proventos". A seção atual
  vai para `<details>` com `<summary>` **"Comparar: gastar o que guardou"**, mantendo **todos** os
  textos atuais (estado vazio "Monte o primeiro cenário", botão "Novo cenário", títulos dos tiles,
  dialog "Editar cenário") para `planos.spec.ts` seguir válido. Novo spec
  `aposentadoria-proventos.spec.ts`.
- `viagens/`: seção "Sugestões para o próximo ano" (pendentes `viagem`): texto fixo "Valores
  aproximados, pela nossa tabela de custos de <ano> para <N> adultos e <M> crianças. Confira passagens
  e hospedagem antes de fechar."; card: destino, "Em julho · 7 dias", "Cerca de R$ 6.400 (R$ 2.100
  por pessoa)", "Guarde R$ 800 por mês até junho", fonte e confiança em texto pequeno, "Adicionar às
  minhas viagens" / "Agora não". Com `trips_per_year = 0`: Card "Quer sugestões de viagem? Diga
  quantas viagens por ano em Configurações › Plano." `saveTrip` usa `createTrip` de
  `packages/agents`.
- `proventos/`: "Rendimento anual da carteira", "renda mensal atual × renda alvo", coluna/linha
  "Previsto" por mês (`forecastDividends`, "previsão pelo histórico; não é garantia").
- `investimentos/`: badge "preço de há N dias" (> 30) e sugestões `investimento` pendentes no topo.
- `reserva/`: campo "Quanto guardar por mês" (`emergency_fund.contribution`) separado do gasto
  essencial; `monthsToReserve` usa `contribution`.

### 4.5 Admin — `/admin`

- Identidade: `ADMIN_USER_IDS` (ids da tabela `user`, separados por vírgula). `ADMIN_EMAILS` só
  para desenvolvimento e e2e (documentar o risco: e-mail sem conta pode ser tomado). Gate
  `requireAdmin()` **dentro de `apps/web/src/lib/session.ts`** (caminho já protegido): `requireSession`
  - id na lista (ou e-mail, se `ADMIN_EMAILS`), senão `notFound()`. `configuracoes/` mostra "ID da
    conta" (para o fundador copiar).
- Layout próprio `src/app/admin/layout.tsx` (`<main>`, h1 "Painel do serviço", `loading.tsx`,
  `error.tsx`, `not-found.tsx`). Toda leitura via `appPool` (auth + ops) exceto a lista de famílias
  (`adminHouseholdList`, read-only). Toda página grava `recordAdminAccess`.
- `/admin` (dia 1): tiles famílias, usuários, novas 7/30 dias, ativas 30 dias
  (`listActiveHouseholdIds(30).length`), cadastros pendentes (contagem via `withAdmin` read-only);
  tabela "Agentes diários" (`listAgentRuns`, 7 dias: agente, famílias, ok, falhas, sugestões,
  aplicadas); "Saúde" (commit web/worker, idade do último heartbeat, versão do schema).
- `/admin/familias`: nome, criada em, membros, última sessão, cadastro complementar; busca por nome
  ou e-mail exato (devolve só aquela família). E-mail do responsável só ao expandir uma linha (ação
  registrada). Rodapé "Dados pessoais mínimos para suporte; cada acesso é registrado."
- `api/ops/context`: `agentRuns: listAgentRuns(14)`.
- E2E `admin.spec.ts`: `test.skip(!process.env.E2E_ADMIN_EMAIL)`; servidor sobe com
  `ADMIN_EMAILS=$E2E_ADMIN_EMAIL`; tenta entrar com senha fixa, senão cadastra (único usuário fixo da
  suíte, comentado); `/admin` abre e passa no axe; usuário aleatório recebe 404.

### 4.6 Textos legais

`LEGAL_VERSION = "2026-10-31"`; Privacidade lista os dados novos (situação de trabalho, INSS,
benefício esperado, dia/mês/ano de casamento, metas, destinos sugeridos) e a frase sobre os agentes
(regras, sem IA, dentro do seu banco, nada sai para terceiros). Sem re-aceite forçado.

## 5. Paperclip e documentação

- `AGENTS.md`: regra 7 reescrita (decisão 0.1); regra 9 nova (agentes diários do produto: worker,
  `fromJob`, uma família por transação, idempotente, só contagens no `ops`, `DAILY_AGENTS_ENABLED`);
  fluxo sem CI (`pnpm check` local é o portão; sem `gh pr checks --watch`; risco pela lista de
  caminhos; Revisor/QA mescla risco baixo; risco alto espera o fundador; `/api/health` mostra o
  commit real); `pnpm test:integration` roda db e agents.
- `paperclip/agentes/comum.md`: lista completa de risco alto igual à de `risk-label.yml`
  (acrescentar `auth-client*`, `ops-auth*`, `next.config.*`, `docker/`, `eslint.config.*`,
  `pnpm-workspace.yaml`); "risco alto nunca entra na rotina diária"; rotina não abre funcionalidade.
- `tech-lead.md`: **Rotina diária 06:00**: ler `/api/ops/context` (inclui `agentRuns`) e
  `/api/ops/deployments`; `pnpm check` em checkout limpo de `main` (sem build: o build é verificado
  pelo deploy — abrir tarefa se o `commit` do último deploy ≠ SHA de `main` há mais de 30 min);
  revisar tarefas abertas; abrir até **3 tarefas de reparo** por dia (prefixo `rotina:`; teste/lint/
  typecheck quebrado, erro em produção, texto errado, estado vazio/erro faltando, dependência com
  aviso, documentação desatualizada, `agentRuns.failed > 0`), sempre risco baixo; risco alto →
  tarefa para o fundador e para. Resumo semanal continua.
- `engenheiro.md` (tarefas `rotina:` seguem o fluxo normal), `revisor-qa.md` (PR `rotina:` de risco
  baixo com `pnpm check` verde é mesclado sem humano; conferir `/api/health` commit real; remover a
  nota sobre `dev`), `sre.md` (checar `agentRuns` do dia; lembrete anual de revisar
  `trip_destination_templates`; manter o resto).
- ADR-0015 e ADR-0016 (o que substituem; premissas numéricas: 10% folga, 50% reserva, 70% dívidas
  caras/aposentadoria, 50/50 metas/viagens, 1% a.m. dívida cara, 30 dias preço, 90 dias revisão,
  60 dias sessão = ativa, 120 meses teto de meta, crianças 0,7, +50% hospedagem por pessoa extra
  acima de 4, yield válido em [1%, 20%], renda alvo = max(essencial × 1,2, gasto médio); admin
  por id, só leitura, acesso registrado; e-mail do responsável só sob ação explícita; finalidade de
  cada dado novo do cadastro).
- `docs/ops-api.md` (`agentRuns`), `docs/custos.md` (crons: Tech Lead 06:00, SRE 07:30, resumo
  semanal), `docs/runbooks/bootstrap.md` e `.env.example` (`ADMIN_USER_IDS`, `ADMIN_EMAILS` só
  dev/e2e, `ADMIN_DATABASE_URL` agora também na web, `ADMIN_DATABASE_POOL_MAX`,
  `DAILY_AGENTS_ENABLED`, `E2E_ADMIN_EMAIL`), `docs/runbooks/deploy.md` (commit real; worker antes da
  web quando houver coluna nova lida pelo layout), `README.md`, `docs/plano-mestre.md` (§3, §9).

## 6. Partição do trabalho (dono único por arquivo)

- **A1 db**: `packages/db/**` (migração, schema, export, finance, ops, wealth, admin, client, jobs,
  migrator grants, RLS test). **A2 domain**: `packages/domain/**` (módulos novos, ampliações,
  index.ts, testes). A1 e A2 em paralelo.
- **B agents+worker**: `packages/agents/**`, `apps/worker/**`, root `package.json` (script
  `test:integration`), `pnpm-workspace.yaml` se preciso. Depois de A.
- Em paralelo depois de B: **C metas/calendário** (`(painel)/metas/**`, `lib/goals.ts`,
  `lib/commitments.ts`, `lib/confirm-entry.ts`, `lancamentos/**`, `calendario/calendar-board.tsx`,
  `(painel)/page.tsx` só rótulos Guardar/Pagar, `components/styles.ts`, `lib/wealth.ts` goals no
  patrimônio, `patrimonio/**`, `reserva/**`, e2e `metas.spec.ts`); **D sugestões/shell/viagens/
  investimentos** (`(painel)/sugestoes/**`, `lib/suggestions.ts`, `components/shell/app-shell.tsx`,
  `(painel)/layout.tsx`, cartão em `(painel)/page.tsx` (coordenar: D é dono de `page.tsx` para o
  cartão; C só troca rótulos via `confirmLabel` — D aplica também essa troca em page.tsx para evitar
  dois donos: **D é o único dono de `(painel)/page.tsx`**), `viagens/**`, `investimentos/**`,
  `proventos/**`, e2e `sugestoes.spec.ts`); **E cadastro complementar/família** (`(inicio)/completar/**`,
  `lib/onboarding.ts`, `app/actions.ts`, `familia/**`, `configuracoes/**`, `first-steps.tsx`,
  `lib/finance-data.ts` (checklist), `legal.ts` + páginas legais, e2e `completar.spec.ts`);
  **F aposentadoria** (`aposentadoria/**`, `lib/planning.ts`, e2e `aposentadoria-proventos.spec.ts`);
  **G admin/ops** (`src/app/admin/**`, `lib/session.ts` requireAdmin, `api/ops/context`,
  `docs/ops-api.md`, e2e `admin.spec.ts`); **H Paperclip/docs** (`AGENTS.md`, `paperclip/agentes/*`,
  ADR-0015/0016, `docs/custos.md`, `README.md`, `docs/plano-mestre.md`, runbooks, `.env.example`).
- Interfaces fixas (quem implementa → quem usa): `onboardingStatus(tx)` (E → D);
  `countPending(tx)` (D); `AppShell.notice`/`pendingSuggestions` (D); `confirmLabel/doneLabel` em
  `components/styles.ts` (C → D usa em page.tsx); `systemCategories(tx)` com `goal/goalIncome/
contribution` (C); `createTrip`, `applySuggestion`, `undoSuggestion`, `runMetasAgent`,
  `dividendPlanInputs` e schemas (B → C, D, F); `requireAdmin()` (G).

## 7. Fora do escopo agora

Cotação automática e importação B3; IA generativa; 2FA do admin; e-mail de aviso das sugestões (sem
SMTP); migração dos cenários antigos para o plano por proventos (convivem); parcelas de proventos
previstos no calendário.
