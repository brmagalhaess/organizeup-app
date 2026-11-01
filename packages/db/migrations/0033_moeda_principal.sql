-- 0033: moeda principal da família (ADR-0020, Fase 6). Só aditiva. Publicada antes do código: enquanto
-- ninguém grava aqui, toda família continua em real e nada muda.
--
-- Duas CHECKs antigas só aceitam real ou só aceitam moeda estrangeira, e trocar CHECK não é aditivo
-- (regra 3 do AGENTS.md). Por isso as colunas abaixo são novas:
--
-- `household_settings.currency` tem CHECK (currency = 'BRL') desde a 0002. A moeda principal fica em
-- `main_currency`, e `currency` segue em 'BRL', sem uso.
ALTER TABLE household_settings
  ADD COLUMN IF NOT EXISTS main_currency text NOT NULL DEFAULT 'BRL'
  CHECK (main_currency IN ('BRL', 'USD', 'EUR'));

-- `transactions.original_currency` só aceita dólar e euro (0030), mas em família em dólar a conta em real
-- é a estrangeira. O lançamento dela guarda aqui o valor em reais e a cotação congelada, em unidades da
-- moeda principal por real. O resto segue igual: `amount` na moeda principal, nulas fora desse caso.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS brl_amount numeric(14,2) CHECK (brl_amount > 0),
  ADD COLUMN IF NOT EXISTS brl_rate numeric(20,8) CHECK (brl_rate > 0),
  ADD CONSTRAINT transactions_brl_all_or_none CHECK ((brl_amount IS NULL) = (brl_rate IS NULL)),
  ADD CONSTRAINT transactions_one_origin CHECK (brl_amount IS NULL OR original_amount IS NULL);
