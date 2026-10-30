-- 0014: aposentadoria (Fase 5). Cada cenário guarda as premissas; o resultado é sempre recalculado.
-- Valores em reais de hoje e retornos reais, acima da inflação. saved NULL usa o valor da carteira.

CREATE TABLE retirement_scenarios (
  id                    text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id          text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  person_id             text NOT NULL,
  name                  text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  target_age            smallint NOT NULL CHECK (target_age BETWEEN 30 AND 100),
  life_expectancy       smallint NOT NULL CHECK (life_expectancy BETWEEN 50 AND 120),
  target_income         numeric(14,2) NOT NULL CHECK (target_income > 0),
  other_income          numeric(14,2) NOT NULL DEFAULT 0 CHECK (other_income >= 0),
  monthly_contribution  numeric(14,2) NOT NULL DEFAULT 0 CHECK (monthly_contribution >= 0),
  saved                 numeric(14,2) CHECK (saved >= 0),
  return_before         numeric(5,2) NOT NULL CHECK (return_before BETWEEN -5 AND 20),
  return_after          numeric(5,2) NOT NULL CHECK (return_after BETWEEN -5 AND 20),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (life_expectancy > target_age),
  FOREIGN KEY (household_id, person_id) REFERENCES people(household_id, id) ON DELETE CASCADE
);
CREATE INDEX retirement_scenarios_household_id_idx ON retirement_scenarios(household_id);

ALTER TABLE retirement_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE retirement_scenarios FORCE ROW LEVEL SECURITY;
CREATE POLICY retirement_scenarios_select ON retirement_scenarios FOR SELECT USING (household_id = app_household_id());
CREATE POLICY retirement_scenarios_insert ON retirement_scenarios FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY retirement_scenarios_update ON retirement_scenarios FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY retirement_scenarios_delete ON retirement_scenarios FOR DELETE USING (household_id = app_household_id() AND app_can_write());
