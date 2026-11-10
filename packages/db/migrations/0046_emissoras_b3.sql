-- 0046: emissoras da B3 (ADR-0036). Só operações aditivas.
--
-- Nome de pregão de cada emissora de ações e BDRs, como a B3 lista e como a nota de corretagem
-- imprime ("PETROBRAS", "CAIXA SEGURI"), com a raiz do código (PETR, CXSE). O código completo nasce
-- da raiz mais o tipo da ação (ON → 3, PN → 4, UNT → 11). Global, sem household_id e sem RLS de
-- tenant, como as outras tabelas de mercado; escrita só pelo worker (grants no migrador); ninguém apaga.
CREATE TABLE market_issuers (
  issuer       text PRIMARY KEY CHECK (issuer ~ '^[A-Z0-9]{4}$'),
  trading_name text NOT NULL CHECK (length(trading_name) BETWEEN 1 AND 40),
  company_name text NOT NULL CHECK (length(company_name) BETWEEN 1 AND 160),
  kind         text NOT NULL CHECK (kind IN ('acao', 'bdr')),
  segment      text CHECK (segment IS NULL OR length(segment) <= 10),
  code_cvm     text CHECK (code_cvm IS NULL OR length(code_cvm) <= 10),
  source       text NOT NULL CHECK (length(source) BETWEEN 1 AND 40),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX market_issuers_trading_name_idx ON market_issuers(trading_name);
