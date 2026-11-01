-- 0023: catálogo de ativos da bolsa, para o cadastro achar nome, tipo e preço sozinho. Só aditiva.
--
-- Global como market_quotes: fato público da bolsa, nada que ligue um ticker a uma família. O job de
-- mercado grava a lista inteira numa chamada só. A busca lê daqui, então o que a família digita não
-- sai do sistema. Grants no migrador: todos leem, só ou_worker grava, ninguém apaga.
CREATE TABLE market_assets (
  ticker       text PRIMARY KEY CHECK (ticker ~ '^[A-Z]{4}[0-9]{1,2}$'),
  name         text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  asset_class  text NOT NULL CHECK (asset_class IN ('acao', 'fii', 'etf_bdr')),
  sector       text CHECK (length(sector) <= 120),
  close        numeric(20,8) CHECK (close > 0),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
