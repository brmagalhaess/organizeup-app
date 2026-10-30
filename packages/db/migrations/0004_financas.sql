-- 0004: núcleo financeiro (Fase 2, parte 1): contas, categorias, previsões recorrentes e lançamentos.

-- Modelos globais, somente leitura para a aplicação; copiados para cada household.
CREATE TABLE category_templates (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('receita', 'despesa')),
  essential  boolean NOT NULL DEFAULT false,
  position   smallint NOT NULL DEFAULT 0
);

INSERT INTO category_templates (id, name, kind, essential, position) VALUES
  ('r-salario',     'Salário',               'receita', false, 1),
  ('r-autonomo',    'Trabalho autônomo',     'receita', false, 2),
  ('r-aluguel',     'Aluguel recebido',      'receita', false, 3),
  ('r-rendimentos', 'Rendimentos',           'receita', false, 4),
  ('r-outros',      'Outras receitas',       'receita', false, 5),
  ('d-moradia',     'Moradia',               'despesa', true,  1),
  ('d-mercado',     'Mercado',               'despesa', true,  2),
  ('d-contas',      'Luz, água e internet',  'despesa', true,  3),
  ('d-saude',       'Saúde',                 'despesa', true,  4),
  ('d-educacao',    'Educação',              'despesa', true,  5),
  ('d-transporte',  'Transporte',            'despesa', true,  6),
  ('d-lazer',       'Lazer',                 'despesa', false, 7),
  ('d-assinaturas', 'Assinaturas',           'despesa', false, 8),
  ('d-compras',     'Compras',               'despesa', false, 9),
  ('d-outros',      'Outras despesas',       'despesa', false, 10);

CREATE TABLE accounts (
  id               text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id     text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  type             text NOT NULL DEFAULT 'corrente'
                   CHECK (type IN ('corrente', 'poupanca', 'dinheiro', 'investimento')),
  opening_balance  numeric(14,2) NOT NULL DEFAULT 0,
  archived         boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id)
);
CREATE INDEX accounts_household_id_idx ON accounts(household_id);

CREATE TABLE categories (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id  text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  kind          text NOT NULL CHECK (kind IN ('receita', 'despesa')),
  essential     boolean NOT NULL DEFAULT false,
  position      smallint NOT NULL DEFAULT 100,
  archived      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id),
  UNIQUE (household_id, kind, name)
);

-- Previsões recorrentes (todo mês). A ocorrência do mês é calculada; só vira lançamento ao ser confirmada.
CREATE TABLE cashflow_plans (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id  text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  account_id    text NOT NULL,
  category_id   text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('receita', 'despesa')),
  description   text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 120),
  amount        numeric(14,2) NOT NULL CHECK (amount > 0),
  day_of_month  smallint NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
  start_month   char(7) NOT NULL CHECK (start_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  end_month     char(7) CHECK (end_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id),
  FOREIGN KEY (household_id, account_id) REFERENCES accounts(household_id, id),
  FOREIGN KEY (household_id, category_id) REFERENCES categories(household_id, id)
);
CREATE INDEX cashflow_plans_household_id_idx ON cashflow_plans(household_id);

CREATE TABLE transactions (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id  text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  account_id    text NOT NULL,
  category_id   text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('receita', 'despesa')),
  description   text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 120),
  amount        numeric(14,2) NOT NULL CHECK (amount > 0),
  occurred_on   date NOT NULL,
  status        text NOT NULL DEFAULT 'realizado' CHECK (status IN ('previsto', 'realizado')),
  plan_id       text,
  plan_month    char(7),
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id),
  FOREIGN KEY (household_id, account_id) REFERENCES accounts(household_id, id),
  FOREIGN KEY (household_id, category_id) REFERENCES categories(household_id, id),
  FOREIGN KEY (household_id, plan_id) REFERENCES cashflow_plans(household_id, id),
  -- Uma previsão gera no máximo um lançamento por mês.
  UNIQUE (household_id, plan_id, plan_month),
  CHECK ((plan_id IS NULL) = (plan_month IS NULL))
);
CREATE INDEX transactions_household_date_idx ON transactions(household_id, occurred_on);

-- ---------- RLS ----------
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY accounts_select ON accounts FOR SELECT USING (household_id = app_household_id());
CREATE POLICY accounts_insert ON accounts FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY accounts_update ON accounts FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY accounts_delete ON accounts FOR DELETE USING (household_id = app_household_id() AND app_can_write());

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories FORCE ROW LEVEL SECURITY;
CREATE POLICY categories_select ON categories FOR SELECT USING (household_id = app_household_id());
CREATE POLICY categories_insert ON categories FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY categories_update ON categories FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY categories_delete ON categories FOR DELETE USING (household_id = app_household_id() AND app_can_write());

ALTER TABLE cashflow_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE cashflow_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY cashflow_plans_select ON cashflow_plans FOR SELECT USING (household_id = app_household_id());
CREATE POLICY cashflow_plans_insert ON cashflow_plans FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY cashflow_plans_update ON cashflow_plans FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY cashflow_plans_delete ON cashflow_plans FOR DELETE USING (household_id = app_household_id() AND app_can_write());

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions FORCE ROW LEVEL SECURITY;
CREATE POLICY transactions_select ON transactions FOR SELECT USING (household_id = app_household_id());
CREATE POLICY transactions_insert ON transactions FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY transactions_update ON transactions FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY transactions_delete ON transactions FOR DELETE USING (household_id = app_household_id() AND app_can_write());
