-- 0005: cartões de crédito e dívidas (Fase 2, parte 2).
-- Compras guardam o valor total; parcelas e faturas são calculadas (ver packages/domain/src/card.ts).
-- Parcelas de dívida são gravadas: juros e amortização não mudam depois de contratados.

INSERT INTO category_templates (id, name, kind, essential, position) VALUES
  ('d-cartao',  'Cartão de crédito',     'despesa', false, 11),
  ('d-dividas', 'Dívidas e empréstimos', 'despesa', true,  12);

CREATE TABLE credit_cards (
  id                 text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id       text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  name               text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  limit_amount       numeric(14,2) CHECK (limit_amount >= 0),
  closing_day        smallint NOT NULL CHECK (closing_day BETWEEN 1 AND 31),
  due_day            smallint NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  paying_account_id  text NOT NULL,
  archived           boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id),
  FOREIGN KEY (household_id, paying_account_id) REFERENCES accounts(household_id, id)
);
CREATE INDEX credit_cards_household_id_idx ON credit_cards(household_id);

CREATE TABLE card_purchases (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id  text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  card_id       text NOT NULL,
  category_id   text NOT NULL,
  description   text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 120),
  amount        numeric(14,2) NOT NULL CHECK (amount > 0),
  installments  smallint NOT NULL DEFAULT 1 CHECK (installments BETWEEN 1 AND 72),
  purchased_on  date NOT NULL,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id),
  FOREIGN KEY (household_id, card_id) REFERENCES credit_cards(household_id, id),
  FOREIGN KEY (household_id, category_id) REFERENCES categories(household_id, id)
);
CREATE INDEX card_purchases_household_card_idx ON card_purchases(household_id, card_id);

-- Pagamento de uma fatura. Apagar o lançamento reabre a fatura.
CREATE TABLE card_statement_payments (
  id               text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id     text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  card_id          text NOT NULL,
  statement_month  char(7) NOT NULL CHECK (statement_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  transaction_id   text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, card_id, statement_month),
  FOREIGN KEY (household_id, card_id) REFERENCES credit_cards(household_id, id),
  FOREIGN KEY (household_id, transaction_id) REFERENCES transactions(household_id, id) ON DELETE CASCADE
);

CREATE TABLE debts (
  id                text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id      text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  account_id        text NOT NULL,
  name              text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  system            text NOT NULL CHECK (system IN ('price', 'sac', 'manual')),
  monthly_rate      numeric(7,4) NOT NULL DEFAULT 0 CHECK (monthly_rate >= 0),
  original_balance  numeric(14,2) NOT NULL CHECK (original_balance > 0),
  archived          boolean NOT NULL DEFAULT false,
  created_by        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id),
  FOREIGN KEY (household_id, account_id) REFERENCES accounts(household_id, id)
);
CREATE INDEX debts_household_id_idx ON debts(household_id);

-- Fonte única das previsões de dívida. Apagar o lançamento devolve a parcela para em aberto.
CREATE TABLE debt_installments (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id    text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  debt_id         text NOT NULL,
  number          smallint NOT NULL CHECK (number > 0),
  due_date        date NOT NULL,
  amount          numeric(14,2) NOT NULL CHECK (amount > 0),
  principal       numeric(14,2) NOT NULL CHECK (principal >= 0),
  interest        numeric(14,2) NOT NULL CHECK (interest >= 0),
  transaction_id  text,
  UNIQUE (household_id, id),
  UNIQUE (household_id, debt_id, number),
  FOREIGN KEY (household_id, debt_id) REFERENCES debts(household_id, id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, transaction_id) REFERENCES transactions(household_id, id)
    ON DELETE SET NULL (transaction_id)
);
CREATE INDEX debt_installments_household_due_idx ON debt_installments(household_id, due_date);

-- ---------- RLS ----------
ALTER TABLE credit_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_cards FORCE ROW LEVEL SECURITY;
CREATE POLICY credit_cards_select ON credit_cards FOR SELECT USING (household_id = app_household_id());
CREATE POLICY credit_cards_insert ON credit_cards FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY credit_cards_update ON credit_cards FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY credit_cards_delete ON credit_cards FOR DELETE USING (household_id = app_household_id() AND app_can_write());

ALTER TABLE card_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_purchases FORCE ROW LEVEL SECURITY;
CREATE POLICY card_purchases_select ON card_purchases FOR SELECT USING (household_id = app_household_id());
CREATE POLICY card_purchases_insert ON card_purchases FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY card_purchases_update ON card_purchases FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY card_purchases_delete ON card_purchases FOR DELETE USING (household_id = app_household_id() AND app_can_write());

ALTER TABLE card_statement_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_statement_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY card_statement_payments_select ON card_statement_payments FOR SELECT USING (household_id = app_household_id());
CREATE POLICY card_statement_payments_insert ON card_statement_payments FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY card_statement_payments_update ON card_statement_payments FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY card_statement_payments_delete ON card_statement_payments FOR DELETE USING (household_id = app_household_id() AND app_can_write());

ALTER TABLE debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE debts FORCE ROW LEVEL SECURITY;
CREATE POLICY debts_select ON debts FOR SELECT USING (household_id = app_household_id());
CREATE POLICY debts_insert ON debts FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY debts_update ON debts FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY debts_delete ON debts FOR DELETE USING (household_id = app_household_id() AND app_can_write());

ALTER TABLE debt_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt_installments FORCE ROW LEVEL SECURITY;
CREATE POLICY debt_installments_select ON debt_installments FOR SELECT USING (household_id = app_household_id());
CREATE POLICY debt_installments_insert ON debt_installments FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY debt_installments_update ON debt_installments FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY debt_installments_delete ON debt_installments FOR DELETE USING (household_id = app_household_id() AND app_can_write());
