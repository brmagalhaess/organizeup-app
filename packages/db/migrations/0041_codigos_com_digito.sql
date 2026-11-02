-- 0041: códigos da B3 com dígito na raiz, como B3SA3 e M1TA34, nas tabelas de mercado (ADR-0029).
--
-- Depende de aprovação do fundador antes do merge. É exceção à regra 3 do AGENTS.md, como a da 0016 (ADR-0015):
-- a CHECK de cada tabela é trocada (DROP CONSTRAINT + ADD CONSTRAINT), porque uma CHECK não se alarga sem isso.
-- Nenhuma linha é apagada ou alterada: a regra nova aceita tudo o que a antiga aceitava.
--
-- Mesmas formas de `TICKER_ROOTS` em packages/domain/src/market.ts. O worker aplica esta migração no boot, antes de
-- rodar o job, e a web só lê estas tabelas: banco atrasado não a afeta.
-- Nome confirmado no Postgres: CHECK inline em coluna vira <tabela>_<coluna>_check.

ALTER TABLE market_quotes DROP CONSTRAINT market_quotes_ticker_check;
ALTER TABLE market_quotes ADD CONSTRAINT market_quotes_ticker_check
  CHECK (ticker ~ '^(([A-Z]{4}|[A-Z][0-9][A-Z]{2}|[A-Z]{2}[0-9][A-Z]|[0-9][A-Z]{3})[0-9]{1,2}|[A-Z][0-9][A-Z][0-9]11)$');

ALTER TABLE market_dividends DROP CONSTRAINT market_dividends_ticker_check;
ALTER TABLE market_dividends ADD CONSTRAINT market_dividends_ticker_check
  CHECK (ticker ~ '^(([A-Z]{4}|[A-Z][0-9][A-Z]{2}|[A-Z]{2}[0-9][A-Z]|[0-9][A-Z]{3})[0-9]{1,2}|[A-Z][0-9][A-Z][0-9]11)$');

ALTER TABLE market_tickers DROP CONSTRAINT market_tickers_ticker_check;
ALTER TABLE market_tickers ADD CONSTRAINT market_tickers_ticker_check
  CHECK (ticker ~ '^(([A-Z]{4}|[A-Z][0-9][A-Z]{2}|[A-Z]{2}[0-9][A-Z]|[0-9][A-Z]{3})[0-9]{1,2}|[A-Z][0-9][A-Z][0-9]11)$');

ALTER TABLE market_stock_events DROP CONSTRAINT market_stock_events_ticker_check;
ALTER TABLE market_stock_events ADD CONSTRAINT market_stock_events_ticker_check
  CHECK (ticker ~ '^(([A-Z]{4}|[A-Z][0-9][A-Z]{2}|[A-Z]{2}[0-9][A-Z]|[0-9][A-Z]{3})[0-9]{1,2}|[A-Z][0-9][A-Z][0-9]11)$');

ALTER TABLE market_assets DROP CONSTRAINT market_assets_ticker_check;
ALTER TABLE market_assets ADD CONSTRAINT market_assets_ticker_check
  CHECK (ticker ~ '^(([A-Z]{4}|[A-Z][0-9][A-Z]{2}|[A-Z]{2}[0-9][A-Z]|[0-9][A-Z]{3})[0-9]{1,2}|[A-Z][0-9][A-Z][0-9]11)$');
