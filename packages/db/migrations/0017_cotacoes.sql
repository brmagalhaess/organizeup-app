-- 0017: cotações e proventos automáticos (ADR-0017). Só operações aditivas.
--
-- Tabelas de mercado são globais, sem household_id e sem RLS de tenant, como
-- trip_destination_templates: guardam fatos públicos da bolsa e do Banco Central e nada que ligue
-- um ticker a uma família. Leitura para a web e o worker; escrita só para ou_worker (grants no
-- migrador). `dividends` e `investments` seguem com a RLS da 0012.

-- Última cotação de cada ticker. O evento em ações serve para avisar a família, porque o sistema
-- ainda não ajusta a quantidade sozinho.
CREATE TABLE market_quotes (
  ticker                 text PRIMARY KEY CHECK (ticker ~ '^[A-Z]{4}[0-9]{1,2}$'),
  price                  numeric(20,8) NOT NULL CHECK (price > 0),
  change_percent         numeric(10,4),
  quoted_at              timestamptz NOT NULL,
  source                 text NOT NULL CHECK (length(source) BETWEEN 1 AND 40),
  last_stock_event_on    date,
  last_stock_event_note  text CHECK (length(last_stock_event_note) <= 120),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Proventos anunciados, por ação ou cota, no valor pago na data (sem o ajuste por desdobramento).
-- com_date é a data-com, que decide o direito; a fonte às vezes não traz ex_date. Pagamento sem
-- data não entra: `dividends.paid_on` é obrigatório. `seq` separa pagamentos com a mesma chave e
-- valores diferentes, que existem na fonte; assim uma correção de valor atualiza a linha.
CREATE TABLE market_dividends (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  ticker          text NOT NULL CHECK (ticker ~ '^[A-Z]{4}[0-9]{1,2}$'),
  kind            text NOT NULL CHECK (kind IN ('dividendo', 'jcp', 'rendimento')),
  com_date        date NOT NULL,
  ex_date         date,
  pay_date        date NOT NULL,
  rate_per_share  numeric(20,8) NOT NULL CHECK (rate_per_share > 0),
  seq             smallint NOT NULL DEFAULT 1 CHECK (seq >= 1),
  source          text NOT NULL CHECK (length(source) BETWEEN 1 AND 40),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticker, kind, com_date, pay_date, seq)
);
CREATE INDEX market_dividends_ticker_idx ON market_dividends(ticker, com_date);

-- Índices do Banco Central (SGS). CDI e SELIC em % ao dia; IPCA em % ao mês, e pode ser negativo.
CREATE TABLE market_indices (
  code   text NOT NULL CHECK (code IN ('CDI', 'SELIC', 'IPCA')),
  date   date NOT NULL,
  value  numeric(20,8) NOT NULL,
  PRIMARY KEY (code, date)
);

-- Situação de cada ticker consultado, sem dizer quem o tem: evita gastar chamada com código que
-- não existe e mostra à família o que aconteceu. Só guarda código que passou no formato da B3.
CREATE TABLE market_tickers (
  ticker              text PRIMARY KEY CHECK (ticker ~ '^[A-Z]{4}[0-9]{1,2}$'),
  status              text NOT NULL CHECK (status IN ('ok', 'desconhecido', 'sem_plano', 'falha')),
  checked_at          timestamptz NOT NULL DEFAULT now(),
  retry_on            date,
  dividends_retry_on  date,
  error_code          text CHECK (length(error_code) <= 40)
);

-- Chamadas pagas à cota da brapi por dia. O teto vale para o dia inteiro, somando todas as rodadas
-- e reinícios do worker: passar do limite do plano encerra a licença (termos de uso da brapi).
CREATE TABLE market_usage (
  day    date PRIMARY KEY,
  calls  integer NOT NULL DEFAULT 0 CHECK (calls >= 0)
);

-- ---------- Colunas novas ----------

-- 'agente' = criado pelo sistema a partir de market_dividends. Excluir um deles deixa uma linha
-- `desfeita` em household_suggestions, para o provento não voltar.
ALTER TABLE dividends
  ADD COLUMN source text NOT NULL DEFAULT 'familia' CHECK (source IN ('familia', 'agente')),
  ADD COLUMN market_dividend_id text REFERENCES market_dividends(id);
CREATE UNIQUE INDEX dividends_market_dividend_unique
  ON dividends(household_id, investment_id, market_dividend_id)
  WHERE market_dividend_id IS NOT NULL;

-- Quem informou o preço atual. O que já existe veio da família.
ALTER TABLE investments
  ADD COLUMN price_source text NOT NULL DEFAULT 'familia' CHECK (price_source IN ('familia', 'mercado'));
