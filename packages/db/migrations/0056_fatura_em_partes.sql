-- 0056: pagamento de fatura em mais de uma vez (ADR-0043). Só operações aditivas.
--
-- A fatura continua com um pagamento principal em card_statement_payments. Os outros débitos da mesma fatura
-- (a segunda parte, o adiantamento, o débito do banco de uma fatura que a família já tinha marcado como paga)
-- ficam ligados aqui, um lançamento por linha. Quem liga e desliga é a família, na tela de cartões.
CREATE TABLE card_statement_parts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  card_id text NOT NULL,
  statement_month char(7) NOT NULL CHECK (statement_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  -- O lançamento que é esta parte do pagamento. Apagado o lançamento, a ligação sai junto.
  transaction_id text NOT NULL,
  -- Quanto este débito tirou do pagamento marcado à mão: é o que volta para ele se a ligação for desfeita.
  replaced_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (replaced_amount >= 0),
  -- A categoria que o lançamento tinha antes de ser ligado, para devolver. Sem FK: a categoria pode sumir.
  previous_category_id text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id),
  -- Um lançamento paga uma fatura só.
  UNIQUE (household_id, transaction_id),
  FOREIGN KEY (household_id, card_id) REFERENCES credit_cards(household_id, id),
  FOREIGN KEY (household_id, transaction_id) REFERENCES transactions(household_id, id) ON DELETE CASCADE
);
CREATE INDEX card_statement_parts_household_id_idx ON card_statement_parts (household_id);
CREATE INDEX card_statement_parts_statement_idx
  ON card_statement_parts (household_id, card_id, statement_month);

ALTER TABLE card_statement_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_statement_parts FORCE ROW LEVEL SECURITY;
CREATE POLICY card_statement_parts_select ON card_statement_parts FOR SELECT USING (household_id = app_household_id());
CREATE POLICY card_statement_parts_insert ON card_statement_parts FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY card_statement_parts_update ON card_statement_parts FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY card_statement_parts_delete ON card_statement_parts FOR DELETE USING (household_id = app_household_id() AND app_can_write());
