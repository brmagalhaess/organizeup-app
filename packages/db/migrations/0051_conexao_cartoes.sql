-- 0051: cartão de crédito pela conexão com bancos (ADR-0038). Só operações aditivas.
--
-- A conta de cartão que vem da Pluggy passa a ser ligada a um cartão do OrganizeUp, e as compras entram em
-- `card_purchases` depois da conferência. A impressão digital evita que a mesma compra entre duas vezes: numa
-- compra parcelada ela é da compra inteira, e não de cada parcela, porque a Pluggy manda uma linha por parcela.

ALTER TABLE bank_connection_accounts
  -- Cartão do OrganizeUp que recebe as compras. Null: ainda não ligado, ou a linha é de conta.
  ADD COLUMN card_id text,
  -- Dias do cartão informados pela instituição, só para sugerir no formulário. Podem faltar.
  ADD COLUMN closing_day smallint CHECK (closing_day BETWEEN 1 AND 31),
  ADD COLUMN due_day smallint CHECK (due_day BETWEEN 1 AND 31),
  ADD FOREIGN KEY (household_id, card_id)
    REFERENCES credit_cards(household_id, id) ON DELETE SET NULL (card_id);

-- Um cartão daqui recebe um cartão do banco só, como nas contas.
CREATE UNIQUE INDEX bank_connection_accounts_card_key
  ON bank_connection_accounts(household_id, card_id) WHERE card_id IS NOT NULL;

ALTER TABLE card_purchases
  ADD COLUMN import_fingerprint text CHECK (length(import_fingerprint) <= 300);

CREATE UNIQUE INDEX card_purchases_import_fingerprint_key
  ON card_purchases(household_id, card_id, import_fingerprint) WHERE import_fingerprint IS NOT NULL;
