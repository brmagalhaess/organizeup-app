-- 0025: transferência entre contas e conta de origem das operações de investimento. Só aditiva.

-- Transferência não é receita nem despesa: fica fora de `transactions` para não entrar em nenhum
-- resumo do mês. Só muda o saldo das duas contas. Conta com transferência não pode ser apagada.
CREATE TABLE account_transfers (
  id               text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id     text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  from_account_id  text NOT NULL,
  to_account_id    text NOT NULL,
  amount           numeric(14,2) NOT NULL CHECK (amount > 0),
  occurred_on      date NOT NULL,
  note             text CHECK (length(note) <= 120),
  created_by       text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id),
  CHECK (from_account_id <> to_account_id),
  FOREIGN KEY (household_id, from_account_id) REFERENCES accounts(household_id, id),
  FOREIGN KEY (household_id, to_account_id) REFERENCES accounts(household_id, id)
);
CREATE INDEX account_transfers_from_idx ON account_transfers(household_id, from_account_id);
CREATE INDEX account_transfers_to_idx ON account_transfers(household_id, to_account_id);

ALTER TABLE account_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_transfers FORCE ROW LEVEL SECURITY;
CREATE POLICY account_transfers_select ON account_transfers FOR SELECT
  USING (household_id = app_household_id());
CREATE POLICY account_transfers_insert ON account_transfers FOR INSERT
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY account_transfers_delete ON account_transfers FOR DELETE
  USING (household_id = app_household_id() AND app_can_write());

-- Lançamento que tirou o dinheiro da conta numa compra, ou o devolveu numa venda. Null: a família
-- não escolheu conta. Apagar o lançamento mantém a operação.
ALTER TABLE investment_trades ADD COLUMN transaction_id text;
ALTER TABLE investment_trades
  ADD CONSTRAINT investment_trades_transaction_fk FOREIGN KEY (household_id, transaction_id)
  REFERENCES transactions(household_id, id) ON DELETE SET NULL (transaction_id);
CREATE INDEX investment_trades_transaction_idx ON investment_trades(household_id, transaction_id);
