-- 0012: investimentos e proventos (Fase 4). Preços vêm da família; cotação automática entra depois.

-- Ação, FII e ETF/BDR valem quantidade × preço. As demais classes valem o total informado.
CREATE TABLE investments (
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id   text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  ticker         text CHECK (ticker ~ '^[A-Z0-9.]{1,12}$'),
  asset_class    text NOT NULL CHECK (asset_class IN
    ('acao', 'fii', 'etf_bdr', 'renda_fixa', 'fundo', 'previdencia', 'exterior', 'outro')),
  current_price  numeric(20,8) CHECK (current_price >= 0),
  current_value  numeric(14,2) CHECK (current_value >= 0),
  valued_on      date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id),
  UNIQUE (household_id, ticker)
);
CREATE INDEX investments_household_id_idx ON investments(household_id);

-- Nas classes sem preço unitário, cada aporte é gravado como quantidade = valor e preço = 1.
CREATE TABLE investment_trades (
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id   text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  investment_id  text NOT NULL,
  side           text NOT NULL CHECK (side IN ('compra', 'venda')),
  occurred_on    date NOT NULL,
  quantity       numeric(20,8) NOT NULL CHECK (quantity > 0),
  unit_price     numeric(20,8) NOT NULL CHECK (unit_price >= 0),
  fees           numeric(14,2) NOT NULL DEFAULT 0 CHECK (fees >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (household_id, investment_id) REFERENCES investments(household_id, id) ON DELETE CASCADE
);
CREATE INDEX investment_trades_investment_idx ON investment_trades(household_id, investment_id);

CREATE TABLE dividends (
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id   text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  investment_id  text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('dividendo', 'jcp', 'rendimento')),
  paid_on        date NOT NULL,
  gross          numeric(14,2) NOT NULL CHECK (gross > 0),
  withheld       numeric(14,2) NOT NULL DEFAULT 0 CHECK (withheld >= 0 AND withheld <= gross),
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (household_id, investment_id) REFERENCES investments(household_id, id) ON DELETE CASCADE
);
CREATE INDEX dividends_household_paid_idx ON dividends(household_id, paid_on);

-- Percentual desejado por classe, para comparar com a carteira. Não indica ativo.
CREATE TABLE investment_targets (
  household_id  text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  asset_class   text NOT NULL,
  percent       numeric(5,2) NOT NULL CHECK (percent > 0 AND percent <= 100),
  PRIMARY KEY (household_id, asset_class)
);

CREATE TABLE dividend_goals (
  household_id    text PRIMARY KEY REFERENCES household(id) ON DELETE CASCADE,
  monthly_amount  numeric(14,2) NOT NULL CHECK (monthly_amount > 0),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------- RLS ----------
ALTER TABLE investments ENABLE ROW LEVEL SECURITY;
ALTER TABLE investments FORCE ROW LEVEL SECURITY;
CREATE POLICY investments_select ON investments FOR SELECT USING (household_id = app_household_id());
CREATE POLICY investments_insert ON investments FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY investments_update ON investments FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY investments_delete ON investments FOR DELETE USING (household_id = app_household_id() AND app_can_write());

ALTER TABLE investment_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE investment_trades FORCE ROW LEVEL SECURITY;
CREATE POLICY investment_trades_select ON investment_trades FOR SELECT USING (household_id = app_household_id());
CREATE POLICY investment_trades_insert ON investment_trades FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY investment_trades_update ON investment_trades FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY investment_trades_delete ON investment_trades FOR DELETE USING (household_id = app_household_id() AND app_can_write());

ALTER TABLE dividends ENABLE ROW LEVEL SECURITY;
ALTER TABLE dividends FORCE ROW LEVEL SECURITY;
CREATE POLICY dividends_select ON dividends FOR SELECT USING (household_id = app_household_id());
CREATE POLICY dividends_insert ON dividends FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY dividends_update ON dividends FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY dividends_delete ON dividends FOR DELETE USING (household_id = app_household_id() AND app_can_write());

ALTER TABLE investment_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE investment_targets FORCE ROW LEVEL SECURITY;
CREATE POLICY investment_targets_select ON investment_targets FOR SELECT USING (household_id = app_household_id());
CREATE POLICY investment_targets_insert ON investment_targets FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY investment_targets_update ON investment_targets FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY investment_targets_delete ON investment_targets FOR DELETE USING (household_id = app_household_id() AND app_can_write());

ALTER TABLE dividend_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE dividend_goals FORCE ROW LEVEL SECURITY;
CREATE POLICY dividend_goals_select ON dividend_goals FOR SELECT USING (household_id = app_household_id());
CREATE POLICY dividend_goals_insert ON dividend_goals FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY dividend_goals_update ON dividend_goals FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY dividend_goals_delete ON dividend_goals FOR DELETE USING (household_id = app_household_id() AND app_can_write());
