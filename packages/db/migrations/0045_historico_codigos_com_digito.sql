-- 0045: códigos da B3 com dígito na raiz (B3SA3, M1TA34) também em market_quote_history.
--
-- A 0043 criou o histórico de cotações (ADR-0033) com a CHECK antiga de ticker, anterior à 0041. Com isso,
-- a coleta de um código com dígito gravava a última cotação em market_quotes e falhava ao gravar o
-- histórico: o ticker ficava como "falha" e os proventos e eventos daquela rodada se perdiam.
--
-- Mesma exceção à regra 3 do AGENTS.md da 0041 (ADR-0029): DROP CONSTRAINT + ADD CONSTRAINT, porque uma
-- CHECK não se alarga sem isso. Nenhuma linha é apagada ou alterada: a regra nova aceita tudo o que a
-- antiga aceitava. Mesmas formas de `TICKER_ROOTS` em packages/domain/src/market.ts.
-- Nome confirmado no Postgres: CHECK inline em coluna vira <tabela>_<coluna>_check.

ALTER TABLE market_quote_history DROP CONSTRAINT market_quote_history_ticker_check;
ALTER TABLE market_quote_history ADD CONSTRAINT market_quote_history_ticker_check
  CHECK (ticker ~ '^(([A-Z]{4}|[A-Z][0-9][A-Z]{2}|[A-Z]{2}[0-9][A-Z]|[0-9][A-Z]{3})[0-9]{1,2}|[A-Z][0-9][A-Z][0-9]11)$');
