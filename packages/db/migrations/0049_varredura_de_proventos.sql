-- 0049: varredura de proventos do universo (ADR-0012, calendário de dividendos). Só operações aditivas.
--
-- Até aqui o job de mercado só buscava proventos dos códigos que alguma família tem. O calendário mostra
-- data-com e pagamento de todos os FIIs e ações do catálogo, então o worker passa a varrer o catálogo em
-- lotes diários, pela B3, e anota aqui quando cada código foi conferido e quando volta a ser.
-- Global, sem household_id e sem RLS de tenant, como as outras tabelas de mercado; escrita só pelo worker.
CREATE TABLE market_dividend_scans (
  ticker      text PRIMARY KEY CHECK (ticker ~ '^[A-Z0-9]{4,10}$'),
  asset_class text NOT NULL CHECK (asset_class IN ('acao', 'fii')),
  scanned_on  date NOT NULL,
  next_on     date NOT NULL,
  error_code  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX market_dividend_scans_next_on_idx ON market_dividend_scans(next_on);
