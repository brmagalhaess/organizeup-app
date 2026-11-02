-- 0040: 13º e férias da renda CLT (ADR-0028). O que a família escolhe por ano e a baixa dos períodos
-- de férias além do primeiro. É dado informado (regra 7): o agente lê e nunca muda. Migração só aditiva,
-- publicada antes do código, sem grants próprios: as tabelas são de tenant, cabem no GRANT geral do
-- migrador, e a RLS (FORCE) restringe. Tabelas novas, e não colunas em `income_sources`, para nenhum
-- `select()` de renda passar a ler coluna que falte enquanto a web sobe antes do worker.

-- Vale do ano da linha em diante, até a próxima linha; ano sem linha anterior usa o padrão de sempre.
-- Marcas de recebido e o valor da 1ª parcela são só do ano da linha: não passam adiante. Em "integral",
-- o mês único fica em `thirteenth_second_month`, e `thirteenth_single_received` é o "Já recebi" desse
-- pagamento; `thirteenth_first_received` continua valendo, como 1ª parcela já paga.
CREATE TABLE income_year_plans (
  id                         text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id               text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  income_source_id           text NOT NULL,
  year                       smallint NOT NULL CHECK (year BETWEEN 2000 AND 2200),
  thirteenth_mode            text NOT NULL DEFAULT 'parcelas' CHECK (thirteenth_mode IN ('parcelas', 'integral')),
  -- Fevereiro a novembro (Lei 4.749/1965, art. 2º). Janeiro só com as férias.
  thirteenth_first_month     smallint NOT NULL DEFAULT 11 CHECK (thirteenth_first_month BETWEEN 2 AND 11),
  thirteenth_second_month    smallint NOT NULL DEFAULT 12 CHECK (thirteenth_second_month BETWEEN 1 AND 12),
  thirteenth_with_vacation   boolean NOT NULL DEFAULT false,
  thirteenth_first_received  boolean NOT NULL DEFAULT false,
  thirteenth_first_amount    numeric(14,2) CHECK (thirteenth_first_amount >= 0),
  thirteenth_single_received boolean NOT NULL DEFAULT false,
  -- Data real de início no emprego: `income_sources.start_month` só diz quando a previsão começa.
  job_started_on             date,
  vacation_sold_days         smallint NOT NULL DEFAULT 0 CHECK (vacation_sold_days BETWEEN 0 AND 10),
  -- Lista de { month, startDay, days, received, keyMonth? }. `keyMonth` guarda o mês da baixa de um
  -- período movido depois de recebido. Sem dinheiro nem dado pessoal.
  vacation_periods           jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(vacation_periods) = 'array'),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id),
  UNIQUE (household_id, income_source_id, year),
  CHECK (thirteenth_mode = 'integral' OR thirteenth_first_month < thirteenth_second_month),
  FOREIGN KEY (household_id, income_source_id) REFERENCES income_sources(household_id, id) ON DELETE CASCADE
);

-- Baixa do 2º e do 3º período de férias, chaves `ferias-2` e `ferias-3`. O 1º continua em
-- `income_receipts` com a parte `ferias`, e a CHECK daquela tabela não muda: trocá-la pediria DROP.
CREATE TABLE income_vacation_receipts (
  id                text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id      text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  income_source_id  text NOT NULL,
  month             char(7) NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  part              text NOT NULL CHECK (part IN ('ferias-2', 'ferias-3')),
  transaction_id    text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, income_source_id, month, part),
  FOREIGN KEY (household_id, income_source_id) REFERENCES income_sources(household_id, id),
  FOREIGN KEY (household_id, transaction_id) REFERENCES transactions(household_id, id) ON DELETE CASCADE
);

-- ---------- RLS ----------
ALTER TABLE income_year_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE income_year_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY income_year_plans_select ON income_year_plans FOR SELECT USING (household_id = app_household_id());
CREATE POLICY income_year_plans_insert ON income_year_plans FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY income_year_plans_update ON income_year_plans FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY income_year_plans_delete ON income_year_plans FOR DELETE USING (household_id = app_household_id() AND app_can_write());

ALTER TABLE income_vacation_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE income_vacation_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY income_vacation_receipts_select ON income_vacation_receipts FOR SELECT USING (household_id = app_household_id());
CREATE POLICY income_vacation_receipts_insert ON income_vacation_receipts FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY income_vacation_receipts_update ON income_vacation_receipts FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY income_vacation_receipts_delete ON income_vacation_receipts FOR DELETE USING (household_id = app_household_id() AND app_can_write());
