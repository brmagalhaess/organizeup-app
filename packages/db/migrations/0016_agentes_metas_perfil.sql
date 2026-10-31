-- 0016: agentes diários, metas e cadastro complementar (ADR-0015 e ADR-0016).
--
-- Exceção única à regra 3 do AGENTS.md, autorizada pelo ADR-0015 (decisão 0.5 da especificação):
-- a CHECK `household_reports_kind_check` é trocada (DROP CONSTRAINT + ADD CONSTRAINT) para aceitar
-- os relatórios dos agentes diários. Tudo o mais aqui é aditivo. Padrão de RLS igual ao da 0015.

-- ---------- Colunas novas ----------

-- Cadastro complementar da família. Dia do casamento é opcional e só serve ao lembrete anual
-- (mesma exceção ao dado mínimo de calendar_events.event_date; ver ADR-0016).
ALTER TABLE household_settings
  ADD COLUMN retirement_year          smallint CHECK (retirement_year BETWEEN 1950 AND 2150),
  ADD COLUMN trips_per_year           smallint NOT NULL DEFAULT 0 CHECK (trips_per_year BETWEEN 0 AND 12),
  ADD COLUMN trip_days                smallint CHECK (trip_days BETWEEN 1 AND 60),
  ADD COLUMN wedding_day              smallint CHECK (wedding_day BETWEEN 1 AND 31),
  ADD COLUMN wedding_month            smallint CHECK (wedding_month BETWEEN 1 AND 12),
  ADD COLUMN wedding_year             smallint CHECK (wedding_year BETWEEN 1900 AND 2100),
  ADD COLUMN wedding_event_id         text,
  ADD COLUMN onboarding_version       smallint NOT NULL DEFAULT 0,
  ADD COLUMN onboarding_completed_at  timestamptz;
-- O evento é criado pela família, nunca pelo agente. SET NULL só da coluna, preservando household_id.
ALTER TABLE household_settings ADD CONSTRAINT household_settings_wedding_event_fkey
  FOREIGN KEY (household_id, wedding_event_id) REFERENCES calendar_events(household_id, id)
  ON DELETE SET NULL (wedding_event_id);

-- Situação de trabalho e previdência de cada pessoa, para o plano de aposentadoria.
ALTER TABLE people
  ADD COLUMN work_status       text CHECK (work_status IN
    ('clt', 'pj_autonomo', 'servidor', 'aposentado', 'estudante', 'sem_renda', 'outro')),
  ADD COLUMN inss_contributor  boolean,
  ADD COLUMN expected_pension  numeric(14,2) CHECK (expected_pension >= 0),
  ADD COLUMN retirement_age    smallint CHECK (retirement_age BETWEEN 40 AND 100);

-- Quem escolheu a categoria do lançamento. NULL = lançamentos antigos (ver especificação §1.1).
ALTER TABLE transactions
  ADD COLUMN category_source text CHECK (category_source IN ('familia', 'importacao', 'revisar', 'agente'));

-- Aporte mensal planejado para a reserva. `monthly_amount` segue sendo o gasto essencial informado.
ALTER TABLE emergency_fund
  ADD COLUMN contribution numeric(14,2) CHECK (contribution >= 0);

-- O worker (papel system na conexão ou_worker) lê a auditoria da família em contexto.
CREATE POLICY audit_log_select_system ON audit_log FOR SELECT
  USING (household_id = app_household_id() AND app_role() = 'system' AND current_user = 'ou_worker');

-- ---------- Tabelas novas ----------

-- Plano de aposentadoria por renda de proventos (1:1). NULL = o agente deriva o valor.
CREATE TABLE retirement_plan (
  household_id          text PRIMARY KEY REFERENCES household(id) ON DELETE CASCADE,
  target_income         numeric(14,2) CHECK (target_income > 0),
  expected_yield        numeric(5,2) CHECK (expected_yield > 0 AND expected_yield <= 30),
  dividend_growth       numeric(5,2) NOT NULL DEFAULT 0 CHECK (dividend_growth BETWEEN -5 AND 15),
  monthly_contribution  numeric(14,2) CHECK (monthly_contribution >= 0),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Metas da família. O que a família informou (nome, valor, data, prioridade, contas) só muda por
-- ação dela; as colunas plan_* são derivadas e o agente recalcula todo dia.
CREATE TABLE goals (
  id                      text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id            text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  name                    text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  kind                    text NOT NULL CHECK (kind IN
    ('veiculo', 'imovel', 'reforma', 'educacao', 'compra', 'evento', 'outro')),
  target_amount           numeric(14,2) NOT NULL CHECK (target_amount > 0),
  saved                   numeric(14,2) NOT NULL DEFAULT 0 CHECK (saved >= 0),
  desired_month           char(7) CHECK (desired_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  priority                smallint NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  status                  text NOT NULL DEFAULT 'planejando' CHECK (status IN
    ('planejando', 'juntando', 'concluida', 'pausada')),
  plan_day                smallint NOT NULL DEFAULT 5 CHECK (plan_day BETWEEN 1 AND 28),
  account_id              text,
  destination_account_id  text,
  plan_start              char(7) CHECK (plan_start ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  plan_end                char(7) CHECK (plan_end ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  plan_monthly            numeric(14,2) CHECK (plan_monthly >= 0),
  plan_note               text CHECK (length(plan_note) <= 400),
  plan_updated_at         timestamptz,
  created_by              text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id),
  FOREIGN KEY (household_id, account_id) REFERENCES accounts(household_id, id)
    ON DELETE SET NULL (account_id),
  FOREIGN KEY (household_id, destination_account_id) REFERENCES accounts(household_id, id)
    ON DELETE SET NULL (destination_account_id)
);
CREATE INDEX goals_household_id_idx ON goals(household_id);

-- Parcelas do plano. Sem transaction_id é previsão (o agente apaga e recria); com transaction_id
-- a família confirmou e a linha não é tocada.
CREATE TABLE goal_contributions (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id    text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  goal_id         text NOT NULL,
  month           char(7) NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  amount          numeric(14,2) NOT NULL CHECK (amount > 0),
  transaction_id  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id),
  UNIQUE (household_id, goal_id, month),
  FOREIGN KEY (household_id, goal_id) REFERENCES goals(household_id, id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, transaction_id) REFERENCES transactions(household_id, id)
    ON DELETE SET NULL (transaction_id)
);
CREATE INDEX goal_contributions_goal_idx ON goal_contributions(household_id, goal_id);

-- Sugestões dos agentes. Toda alteração automática também fica aqui, como `aplicada` por `agente`,
-- com o estado anterior no payload para Desfazer (regra 7 reescrita; ADR-0015).
CREATE TABLE household_suggestions (
  id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  agent        text NOT NULL CHECK (agent ~ '^[a-z0-9-]{1,40}$'),
  kind         text NOT NULL CHECK (kind IN
    ('categoria', 'fusao_categoria', 'aporte_reserva', 'aporte_divida', 'aporte_investimento',
     'viagem', 'meta', 'investimento', 'lembrete')),
  title        text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  body         text NOT NULL CHECK (length(body) BETWEEN 1 AND 800),
  payload      jsonb NOT NULL DEFAULT '{}',
  status       text NOT NULL DEFAULT 'pendente' CHECK (status IN
    ('pendente', 'aplicada', 'ignorada', 'desfeita')),
  applied_by   text NOT NULL DEFAULT 'familia' CHECK (applied_by IN ('familia', 'agente')),
  dedupe_key   text NOT NULL CHECK (length(dedupe_key) BETWEEN 1 AND 160),
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz,
  decided_by   text,
  UNIQUE (household_id, id)
);
-- Uma sugestão pendente por chave: o agente faz upsert aqui sem recriar o que já está na fila.
CREATE UNIQUE INDEX household_suggestions_pending_dedupe
  ON household_suggestions(household_id, dedupe_key) WHERE status = 'pendente';
CREATE INDEX household_suggestions_status_idx
  ON household_suggestions(household_id, status, created_at DESC);
CREATE INDEX household_suggestions_dedupe_idx
  ON household_suggestions(household_id, dedupe_key, status);

-- ---------- Tabela global de destinos (somente leitura; REVOKE no migrador) ----------
--
-- Referência para o agente de viagens estimar custos. Cada linha cita a fonte real e o mês/ano da
-- consulta; linha sem fonte não entra. Premissas comuns a todas as linhas:
--  * hospedagem: preço médio do quarto duplo informado pela fonte × 1,4 (quarto para família de
--    até 4 pessoas), por noite; o domínio soma 50% por pessoa acima de 4;
--  * alimentação e transporte local: média diária por pessoa da fonte;
--  * passagem: ida e volta por pessoa, saída do Brasil (média nacional da ANAC nos destinos
--    domésticos; médias de 12 meses do KAYAK nos internacionais);
--  * câmbio: R$ 5,40 por dólar (PTAX de out/2026 arredondada) quando a fonte está em dólar;
--  * hospedagem e passagem arredondadas à centena; alimentação e transporte à dezena;
--  * passeios não são estimados: a família preenche.
CREATE TABLE trip_destination_templates (
  id                              text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{1,40}$'),
  name                            text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  country                         char(2) NOT NULL,
  region                          text NOT NULL CHECK (region IN
    ('brasil_perto', 'brasil', 'america_sul', 'america_norte', 'europa', 'asia_oceania')),
  lodging_per_night               numeric(14,2) NOT NULL CHECK (lodging_per_night >= 0),
  food_per_person_day             numeric(14,2) NOT NULL CHECK (food_per_person_day >= 0),
  local_transport_per_person_day  numeric(14,2) NOT NULL CHECK (local_transport_per_person_day >= 0),
  flight_per_person               numeric(14,2) NOT NULL CHECK (flight_per_person >= 0),
  min_days                        smallint NOT NULL DEFAULT 3 CHECK (min_days BETWEEN 1 AND 60),
  kids_friendly                   boolean NOT NULL DEFAULT true,
  best_months                     text NOT NULL DEFAULT '' CHECK (best_months ~ '^(\d{1,2}(,\d{1,2})*)?$'),
  source                          text NOT NULL CHECK (length(source) BETWEEN 10 AND 600),
  confidence                      text NOT NULL CHECK (confidence IN ('baixa', 'media')),
  position                        smallint NOT NULL DEFAULT 0
);

INSERT INTO trip_destination_templates
  (id, name, country, region, lodging_per_night, food_per_person_day, local_transport_per_person_day,
   flight_per_person, min_days, kids_friendly, best_months, source, confidence, position) VALUES
  ('rio-de-janeiro', 'Rio de Janeiro', 'BR', 'brasil', 1000.00, 180.00, 40.00, 1400.00, 4, true, '4,5,6,7,8,9',
   'Budget Your Trip (budgetyourtrip.com/brazil/rio-de-janeiro), consulta 10/2026: hotel US$ 65 por pessoa em quarto duplo, alimentação US$ 34/dia, transporte US$ 8/dia. Passagem: ANAC, tarifa média doméstica real R$ 703,52 por trecho (jul/2026), ida e volta, sem taxas.',
   'media', 1),
  ('salvador', 'Salvador', 'BR', 'brasil', 400.00, 110.00, 30.00, 1400.00, 4, true, '1,2,9,10,11,12',
   'Budget Your Trip (budgetyourtrip.com/brazil/salvador), consulta 10/2026: quarto duplo US$ 48, alimentação R$ 114/dia, transporte US$ 5,91/dia. Passagem: ANAC, tarifa média doméstica real R$ 703,52 por trecho (jul/2026), ida e volta, sem taxas.',
   'media', 2),
  ('florianopolis', 'Florianópolis', 'BR', 'brasil', 800.00, 210.00, 70.00, 1400.00, 4, true, '1,2,3,12',
   'Budget Your Trip (budgetyourtrip.com/brazil/florianopolis), consulta 10/2026: hotel US$ 53 por pessoa em quarto duplo, alimentação US$ 39/dia, transporte US$ 13/dia. Passagem: ANAC, tarifa média doméstica real R$ 703,52 por trecho (jul/2026), ida e volta, sem taxas.',
   'media', 3),
  ('foz-do-iguacu', 'Foz do Iguaçu', 'BR', 'brasil', 400.00, 200.00, 70.00, 1400.00, 3, true, '3,4,5,8,9,10',
   'Budget Your Trip (budgetyourtrip.com/brazil/foz-do-iguacu), consulta 10/2026: quarto duplo US$ 55, alimentação US$ 36 a 39/dia, transporte US$ 13/dia. Passagem: ANAC, tarifa média doméstica real R$ 703,52 por trecho (jul/2026), ida e volta, sem taxas.',
   'media', 4),
  ('fortaleza', 'Fortaleza', 'BR', 'brasil', 400.00, 210.00, 110.00, 1400.00, 4, true, '7,8,9,10,11,12',
   'Budget Your Trip (budgetyourtrip.com/brazil/fortaleza), consulta 10/2026: quarto duplo US$ 57, alimentação US$ 39/dia, transporte US$ 20/dia. Passagem: ANAC, tarifa média doméstica real R$ 703,52 por trecho (jul/2026), ida e volta, sem taxas.',
   'media', 5),
  ('buenos-aires', 'Buenos Aires', 'AR', 'america_sul', 600.00, 40.00, 10.00, 2000.00, 4, true, '3,4,5,9,10,11',
   'Budget Your Trip (budgetyourtrip.com/argentina/buenos-aires-argentina), consulta 10/2026: hotel US$ 39 por pessoa em quarto duplo, alimentação US$ 8/dia, transporte US$ 2/dia (valores baixos pela inflação local; confiança baixa). Passagem: KAYAK, rankings de buscas no Brasil, R$ 1.903 a R$ 2.333 ida e volta (verão 2025/26 a jul/2026).',
   'baixa', 10),
  ('santiago', 'Santiago', 'CL', 'america_sul', 1700.00, 120.00, 30.00, 1600.00, 4, true, '3,4,7,8,10,11',
   'Budget Your Trip (budgetyourtrip.com/chile/santiago), consulta 10/2026: quarto duplo US$ 223 (hotel US$ 111 por pessoa), alimentação US$ 23/dia, transporte US$ 5,50/dia; páginas divergem, confiança baixa. Passagem: KAYAK, média de 12 meses GRU-SCL ida e volta R$ 1.558 (consulta 10/2026).',
   'baixa', 11),
  ('montevideu', 'Montevidéu', 'UY', 'america_sul', 600.00, 120.00, 40.00, 2000.00, 3, true, '1,2,3,12',
   'Budget Your Trip (budgetyourtrip.com/uruguay/montevideo), consulta 10/2026: quarto duplo US$ 76, alimentação US$ 22/dia, transporte US$ 7,04/dia. Passagem: KAYAK, média de 12 meses Brasil-Montevidéu ida e volta R$ 1.966 (consulta 10/2026).',
   'media', 12),
  ('lima', 'Lima', 'PE', 'america_sul', 800.00, 170.00, 30.00, 2800.00, 4, true, '5,6,7,8,9,10',
   'Budget Your Trip (budgetyourtrip.com/peru/lima), consulta 10/2026: quarto duplo US$ 105, alimentação US$ 32/dia, transporte US$ 6/dia. Passagem: KAYAK, média de 12 meses Brasil-Lima ida e volta R$ 2.754 (consulta 10/2026).',
   'media', 13),
  ('orlando', 'Orlando', 'US', 'america_norte', 2300.00, 610.00, 360.00, 4700.00, 7, true, '2,3,5,9,10,11',
   'Budget Your Trip (budgetyourtrip.com/united-states-of-america/orlando), consulta 10/2026: quarto duplo US$ 308, alimentação US$ 113/dia, transporte US$ 66/dia. Passagem: KAYAK, rankings de buscas no Brasil, R$ 4.173 a R$ 5.036 ida e volta (verão 2025/26 a jul/2026).',
   'media', 20),
  ('nova-york', 'Nova York', 'US', 'america_norte', 2600.00, 470.00, 260.00, 5600.00, 6, true, '4,5,9,10',
   'Budget Your Trip (budgetyourtrip.com/united-states-of-america/new-york-city), consulta 10/2026: quarto duplo US$ 350, alimentação US$ 87/dia, transporte US$ 49/dia. Passagem: KAYAK, média de 12 meses Brasil-Nova York em voos diretos, ida e volta R$ 5.620 (consulta 10/2026).',
   'media', 21),
  ('cancun', 'Cancún', 'MX', 'america_norte', 1400.00, 240.00, 90.00, 2600.00, 6, true, '2,3,4,11,12',
   'Budget Your Trip (budgetyourtrip.com/mexico/cancun), consulta 10/2026: quarto duplo US$ 180, alimentação US$ 45/dia, transporte US$ 16/dia. Passagem: KAYAK, preços típicos São Paulo-Cancún ida e volta R$ 2.249 a R$ 2.806 (consulta 10/2026); outras origens bem acima, confiança baixa.',
   'baixa', 22),
  ('lisboa', 'Lisboa', 'PT', 'europa', 1100.00, 450.00, 150.00, 6000.00, 7, true, '4,5,6,9,10',
   'Budget Your Trip (budgetyourtrip.com/portugal/lisbon), consulta 10/2026: quarto duplo US$ 144, alimentação US$ 83/dia, transporte US$ 28/dia. Passagem: KAYAK, rankings de buscas no Brasil, R$ 4.763 a R$ 7.467 ida e volta (2026), média usada R$ 6.000.',
   'media', 30),
  ('paris', 'Paris', 'FR', 'europa', 2600.00, 440.00, 130.00, 7600.00, 7, true, '4,5,6,9,10',
   'Budget Your Trip (budgetyourtrip.com/france/paris), consulta 10/2026: quarto duplo US$ 344, alimentação US$ 81/dia, transporte US$ 24/dia. Passagem: KAYAK, rankings de buscas no Brasil, R$ 6.666 (verão 2025/26) e R$ 8.628 (jul/2026) ida e volta, média usada R$ 7.600.',
   'media', 31),
  ('roma', 'Roma', 'IT', 'europa', 1100.00, 510.00, 130.00, 5200.00, 7, true, '4,5,9,10',
   'Budget Your Trip (budgetyourtrip.com/italy/rome), consulta 10/2026: hotel típico US$ 144 por noite, alimentação US$ 95/dia, transporte US$ 24/dia. Passagem: KAYAK, média de 12 meses Brasil-Roma Fiumicino ida e volta R$ 5.160 (consulta 10/2026).',
   'media', 32),
  ('madri', 'Madri', 'ES', 'europa', 1300.00, 360.00, 110.00, 4300.00, 7, true, '4,5,6,9,10',
   'Budget Your Trip (budgetyourtrip.com/spain/madrid), consulta 10/2026: quarto duplo US$ 174, alimentação US$ 66/dia, transporte US$ 21/dia. Passagem: KAYAK, média de 12 meses Brasil-Madri ida e volta R$ 4.306 (consulta 10/2026).',
   'media', 33),
  ('toquio', 'Tóquio', 'JP', 'asia_oceania', 1100.00, 340.00, 90.00, 7500.00, 10, true, '3,4,10,11',
   'Budget Your Trip (budgetyourtrip.com/japan/tokyo), consulta 10/2026: quarto duplo US$ 150, alimentação US$ 63/dia, transporte US$ 17/dia. Passagem: KAYAK, média de 12 meses Brasil-Tóquio ida e volta R$ 7.479 (consulta 10/2026).',
   'media', 40),
  ('bangkok', 'Bangkok', 'TH', 'asia_oceania', 700.00, 180.00, 30.00, 7500.00, 10, true, '1,2,11,12',
   'Budget Your Trip (budgetyourtrip.com/thailand/bangkok), consulta 10/2026: quarto duplo US$ 95, alimentação US$ 34/dia, transporte US$ 6/dia; páginas de hotel divergem, confiança baixa. Passagem: KAYAK, média de 12 meses Brasil-Bangkok Suvarnabhumi ida e volta R$ 7.486 (consulta 10/2026).',
   'baixa', 41);

-- ---------- Categorias do sistema para metas e aportes ----------
INSERT INTO category_templates (id, name, kind, essential, position) VALUES
  ('d-metas',   'Metas e objetivos',       'despesa', false, 90),
  ('r-metas',   'Metas e objetivos',       'receita', false, 90),
  ('d-aportes', 'Aportes e investimentos', 'despesa', false, 91);

-- ---------- Relatórios dos agentes diários (decisão 0.5; ADR-0015) ----------
-- Nome confirmado no Postgres: CHECK inline em coluna vira <tabela>_<coluna>_check.
ALTER TABLE household_reports DROP CONSTRAINT household_reports_kind_check;
ALTER TABLE household_reports ADD CONSTRAINT household_reports_kind_check
  CHECK (kind IN ('importacao', 'categorias', 'investimentos', 'aposentadoria', 'viagens', 'metas'));

-- ---------- ops: só contagens, nada identifica a família ----------

-- Uma linha por dia e agente. O upsert substitui as contagens e soma 1 em runs. Só o worker grava.
CREATE TABLE ops.agent_runs (
  day          date NOT NULL,
  agent        text NOT NULL CHECK (agent ~ '^[a-z0-9-]{1,40}$'),
  runs         integer NOT NULL DEFAULT 1 CHECK (runs > 0),
  households   integer NOT NULL DEFAULT 0 CHECK (households >= 0),
  ok           integer NOT NULL DEFAULT 0 CHECK (ok >= 0),
  failed       integer NOT NULL DEFAULT 0 CHECK (failed >= 0),
  suggestions  integer NOT NULL DEFAULT 0 CHECK (suggestions >= 0),
  applied      integer NOT NULL DEFAULT 0 CHECK (applied >= 0),
  duration_ms  integer CHECK (duration_ms >= 0),
  finished_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, agent)
);

-- Cada acesso do painel do serviço. Nunca guarda o texto da busca. Só a web grava.
CREATE TABLE ops.admin_access (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at                   timestamptz NOT NULL DEFAULT now(),
  admin_user_id        text NOT NULL,
  action               text NOT NULL CHECK (length(action) BETWEEN 1 AND 60),
  target_household_id  text
);
CREATE INDEX admin_access_at_idx ON ops.admin_access(at DESC);

-- ---------- RLS ----------
ALTER TABLE retirement_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE retirement_plan FORCE ROW LEVEL SECURITY;
CREATE POLICY retirement_plan_select ON retirement_plan FOR SELECT USING (household_id = app_household_id());
CREATE POLICY retirement_plan_insert ON retirement_plan FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY retirement_plan_update ON retirement_plan FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
-- Sem policy DELETE: 1:1 com a família, como household_settings.

ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals FORCE ROW LEVEL SECURITY;
CREATE POLICY goals_select ON goals FOR SELECT USING (household_id = app_household_id());
CREATE POLICY goals_insert ON goals FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY goals_update ON goals FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY goals_delete ON goals FOR DELETE USING (household_id = app_household_id() AND app_can_write());

ALTER TABLE goal_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_contributions FORCE ROW LEVEL SECURITY;
CREATE POLICY goal_contributions_select ON goal_contributions FOR SELECT USING (household_id = app_household_id());
CREATE POLICY goal_contributions_insert ON goal_contributions FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY goal_contributions_update ON goal_contributions FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY goal_contributions_delete ON goal_contributions FOR DELETE USING (household_id = app_household_id() AND app_can_write());

ALTER TABLE household_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_suggestions FORCE ROW LEVEL SECURITY;
CREATE POLICY household_suggestions_select ON household_suggestions FOR SELECT USING (household_id = app_household_id());
CREATE POLICY household_suggestions_insert ON household_suggestions FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY household_suggestions_update ON household_suggestions FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY household_suggestions_delete ON household_suggestions FOR DELETE USING (household_id = app_household_id() AND app_can_write());
