-- 0007: reserva de emergência e patrimônio (Fase 2, parte 4).

-- A meta da reserva: meses de gasto essencial. Uma linha por household.
CREATE TABLE emergency_fund (
  household_id    text PRIMARY KEY REFERENCES household(id) ON DELETE CASCADE,
  target_months   smallint NOT NULL DEFAULT 6 CHECK (target_months BETWEEN 1 AND 60),
  monthly_amount  numeric(14,2) CHECK (monthly_amount > 0),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Para que serve cada conta. Por ora só "reserva"; depois objetivos e aposentadoria.
CREATE TABLE earmarks (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id  text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  account_id    text NOT NULL,
  purpose       text NOT NULL CHECK (purpose IN ('reserva')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, account_id, purpose),
  FOREIGN KEY (household_id, account_id) REFERENCES accounts(household_id, id)
);

-- Bens fora das contas. O valor é informado pela família.
CREATE TABLE assets (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id    text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  kind            text NOT NULL CHECK (kind IN ('imovel', 'veiculo', 'outro')),
  value           numeric(14,2) NOT NULL CHECK (value >= 0),
  valued_on       date NOT NULL,
  linked_debt_id  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id),
  FOREIGN KEY (household_id, linked_debt_id) REFERENCES debts(household_id, id)
    ON DELETE SET NULL (linked_debt_id)
);
CREATE INDEX assets_household_id_idx ON assets(household_id);

-- Foto mensal: bens não têm histórico, então a evolução não pode ser recalculada depois.
CREATE TABLE net_worth_snapshots (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id  text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  month         char(7) NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  owned         numeric(16,2) NOT NULL,
  owed          numeric(16,2) NOT NULL,
  net           numeric(16,2) NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, month)
);

-- ---------- RLS ----------
ALTER TABLE emergency_fund ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergency_fund FORCE ROW LEVEL SECURITY;
CREATE POLICY emergency_fund_select ON emergency_fund FOR SELECT USING (household_id = app_household_id());
CREATE POLICY emergency_fund_insert ON emergency_fund FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY emergency_fund_update ON emergency_fund FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY emergency_fund_delete ON emergency_fund FOR DELETE USING (household_id = app_household_id() AND app_can_write());

ALTER TABLE earmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE earmarks FORCE ROW LEVEL SECURITY;
CREATE POLICY earmarks_select ON earmarks FOR SELECT USING (household_id = app_household_id());
CREATE POLICY earmarks_insert ON earmarks FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY earmarks_update ON earmarks FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY earmarks_delete ON earmarks FOR DELETE USING (household_id = app_household_id() AND app_can_write());

ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets FORCE ROW LEVEL SECURITY;
CREATE POLICY assets_select ON assets FOR SELECT USING (household_id = app_household_id());
CREATE POLICY assets_insert ON assets FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY assets_update ON assets FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY assets_delete ON assets FOR DELETE USING (household_id = app_household_id() AND app_can_write());

ALTER TABLE net_worth_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE net_worth_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY net_worth_snapshots_select ON net_worth_snapshots FOR SELECT USING (household_id = app_household_id());
CREATE POLICY net_worth_snapshots_insert ON net_worth_snapshots FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY net_worth_snapshots_update ON net_worth_snapshots FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY net_worth_snapshots_delete ON net_worth_snapshots FOR DELETE USING (household_id = app_household_id() AND app_can_write());
