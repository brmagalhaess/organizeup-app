-- 0030: contas em dólar e euro (ADR-0020, Fase 5). Só aditiva. Publicada antes do código: a web lê
-- `accounts` com todas as colunas, no layout e em toda parte.
--
-- `transactions.amount` continua sempre em reais: resumos, planos, agentes, IA e calendário somam essa
-- coluna. O que foi digitado em conta estrangeira fica ao lado, com a cotação congelada.

ALTER TABLE accounts
  ADD COLUMN currency text NOT NULL DEFAULT 'BRL'
  CHECK (currency IN ('BRL', 'USD', 'EUR'));

ALTER TABLE transactions
  ADD COLUMN original_amount numeric(14,2) CHECK (original_amount > 0),
  ADD COLUMN original_currency text CHECK (original_currency IN ('USD', 'EUR')),
  ADD COLUMN fx_rate numeric(20,8) CHECK (fx_rate > 0),
  ADD CONSTRAINT transactions_original_all_or_none
    CHECK (num_nonnulls(original_amount, original_currency, fx_rate) IN (0, 3));

-- Null nas duas: mesmo valor nas duas pontas. `amount` é o que saiu da conta de origem, na moeda dela;
-- `to_amount` é o que entrou na de destino, na moeda dela. `fx_rate` é a taxa real da transferência: reais
-- por unidade da moeda estrangeira, ou unidades de destino por unidade de origem entre duas estrangeiras.
ALTER TABLE account_transfers
  ADD COLUMN to_amount numeric(14,2) CHECK (to_amount > 0),
  ADD COLUMN fx_rate numeric(20,8) CHECK (fx_rate > 0),
  ADD CONSTRAINT account_transfers_fx_all_or_none
    CHECK ((to_amount IS NULL) = (fx_rate IS NULL));

-- PTAX de venda, em reais por unidade, global como market_quotes: não liga nada a uma família. Depois
-- de gravada, não muda. Grants no migrador: todos leem, só ou_worker grava, ninguém apaga.
CREATE TABLE market_fx (
  currency    text NOT NULL CHECK (currency IN ('USD', 'EUR')),
  date        date NOT NULL,
  rate        numeric(20,8) NOT NULL CHECK (rate > 0),
  source      text NOT NULL CHECK (length(source) BETWEEN 1 AND 40),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (currency, date)
);
