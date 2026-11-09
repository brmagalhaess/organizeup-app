-- 0043: histórico de cotações (ADR-0033). Só operações aditivas.
--
-- market_quotes continua com a última cotação de cada ticker, para leitura rápida. Esta tabela
-- guarda cada coleta: de hora em hora com a bolsa aberta e o fechamento do dia. Global, sem
-- household_id e sem RLS de tenant, como as outras tabelas de mercado; escrita só pelo worker
-- (grants no migrador). Nunca se apaga: compactação futura fica por ADR.
CREATE TABLE market_quote_history (
  ticker     text NOT NULL CHECK (ticker ~ '^[A-Z]{4}[0-9]{1,2}$'),
  quoted_at  timestamptz NOT NULL,
  price      numeric(20,8) NOT NULL CHECK (price > 0),
  source     text NOT NULL CHECK (length(source) BETWEEN 1 AND 40),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticker, quoted_at)
);
CREATE INDEX market_quote_history_quoted_idx ON market_quote_history(quoted_at);
