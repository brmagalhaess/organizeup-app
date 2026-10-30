-- 0009: renda (Fase 2, parte 6). Bruto para líquido na CLT e rendas que entram como previsão.

-- Tabelas de INSS e IR por vigência. Globais e somente leitura para a aplicação (ver o migrador).
-- Valores em texto para não passarem por ponto flutuante. Fontes no ADR-0009.
CREATE TABLE fiscal_parameters (
  valid_from  char(7) PRIMARY KEY CHECK (valid_from ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  source      text NOT NULL,
  params      jsonb NOT NULL
);

INSERT INTO fiscal_parameters (valid_from, source, params) VALUES (
  '2026-01',
  'INSS: Portaria Interministerial MPS/MF 13, de 09/01/2026. IRRF: Receita Federal, Tributação de 2026. Redução: Lei 15.270/2025.',
  '{
    "minimumWage": "1621.00",
    "inss": [
      {"upTo": "1621.00", "rate": "0.075"},
      {"upTo": "2902.84", "rate": "0.09"},
      {"upTo": "4354.27", "rate": "0.12"},
      {"upTo": "8475.55", "rate": "0.14"}
    ],
    "irrf": [
      {"upTo": "2428.80", "rate": "0", "deduction": "0"},
      {"upTo": "2826.65", "rate": "0.075", "deduction": "182.16"},
      {"upTo": "3751.05", "rate": "0.15", "deduction": "394.16"},
      {"upTo": "4664.68", "rate": "0.225", "deduction": "675.49"},
      {"upTo": null, "rate": "0.275", "deduction": "908.73"}
    ],
    "dependentDeduction": "189.59",
    "simplifiedDeduction": "607.20",
    "reduction": {
      "fullUpTo": "5000.00",
      "maxAmount": "312.89",
      "phaseOutUpTo": "7350.00",
      "base": "978.62",
      "factor": "0.133145"
    }
  }'::jsonb
);

CREATE TABLE income_sources (
  id               text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id     text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  person_id        text,
  account_id       text NOT NULL,
  category_id      text NOT NULL,
  name             text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  kind             text NOT NULL CHECK (kind IN ('clt', 'pj_autonomo', 'aposentadoria_pensao', 'aluguel', 'outro')),
  -- Na CLT é o bruto; nos outros tipos, o valor que cai na conta.
  amount           numeric(14,2) NOT NULL CHECK (amount > 0),
  is_gross         boolean NOT NULL DEFAULT false,
  dependents       smallint NOT NULL DEFAULT 0 CHECK (dependents BETWEEN 0 AND 20),
  pension_amount   numeric(14,2) NOT NULL DEFAULT 0 CHECK (pension_amount >= 0),
  other_discounts  numeric(14,2) NOT NULL DEFAULT 0 CHECK (other_discounts >= 0),
  vacation_month   smallint CHECK (vacation_month BETWEEN 1 AND 12),
  pay_day          smallint NOT NULL CHECK (pay_day BETWEEN 1 AND 31),
  start_month      char(7) NOT NULL CHECK (start_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  end_month        char(7) CHECK (end_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id),
  FOREIGN KEY (household_id, person_id) REFERENCES people(household_id, id)
    ON DELETE SET NULL (person_id),
  FOREIGN KEY (household_id, account_id) REFERENCES accounts(household_id, id),
  FOREIGN KEY (household_id, category_id) REFERENCES categories(household_id, id)
);
CREATE INDEX income_sources_household_id_idx ON income_sources(household_id);

-- Liga cada pagamento recebido ao lançamento. Apagar o lançamento devolve a previsão.
CREATE TABLE income_receipts (
  id                text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id      text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  income_source_id  text NOT NULL,
  month             char(7) NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  part              text NOT NULL CHECK (part IN ('salario', 'ferias', '13-1', '13-2')),
  transaction_id    text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, income_source_id, month, part),
  FOREIGN KEY (household_id, income_source_id) REFERENCES income_sources(household_id, id),
  FOREIGN KEY (household_id, transaction_id) REFERENCES transactions(household_id, id) ON DELETE CASCADE
);

-- ---------- RLS ----------
ALTER TABLE income_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE income_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY income_sources_select ON income_sources FOR SELECT USING (household_id = app_household_id());
CREATE POLICY income_sources_insert ON income_sources FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY income_sources_update ON income_sources FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY income_sources_delete ON income_sources FOR DELETE USING (household_id = app_household_id() AND app_can_write());

ALTER TABLE income_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE income_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY income_receipts_select ON income_receipts FOR SELECT USING (household_id = app_household_id());
CREATE POLICY income_receipts_insert ON income_receipts FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY income_receipts_update ON income_receipts FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY income_receipts_delete ON income_receipts FOR DELETE USING (household_id = app_household_id() AND app_can_write());
