-- 0021: desdobramento, grupamento e bonificação na posição (ADR-0017). Só aditiva.
--
-- O comentário da 0017 ("o sistema ainda não ajusta a quantidade sozinho") ficou para trás: não se
-- edita migração aplicada. `market_quotes.last_stock_event_*` continua sendo escrita.

-- Fatos públicos da bolsa, globais como market_quotes: nada aqui liga um ticker a uma família.
-- `factor` é o que a fonte manda: ações novas por ação antiga (0,1 num grupamento de 10 para 1).
-- Grants no migrador: todos leem, só ou_worker grava, ninguém apaga.
CREATE TABLE market_stock_events (
  ticker      text NOT NULL CHECK (ticker ~ '^[A-Z]{4}[0-9]{1,2}$'),
  com_date    date NOT NULL,
  factor      numeric(20,8) NOT NULL CHECK (factor > 0),
  note        text NOT NULL CHECK (length(note) BETWEEN 1 AND 120),
  source      text NOT NULL CHECK (length(source) BETWEEN 1 AND 40),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticker, com_date, note)
);

-- Evento aplicado à carteira de uma família. As operações (`investment_trades`) são o que a família
-- digitou e não mudam: `positionOf` aplica estas linhas por cima. Dado derivado: quem grava é o
-- agente, com sugestão `aplicada`, e Desfazer apaga a linha (regra 7).
CREATE TABLE investment_stock_events (
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id   text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  investment_id  text NOT NULL,
  com_date       date NOT NULL,
  factor         numeric(20,8) NOT NULL CHECK (factor > 0),
  note           text NOT NULL CHECK (length(note) BETWEEN 1 AND 120),
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (household_id, investment_id)
    REFERENCES investments(household_id, id) ON DELETE CASCADE,
  UNIQUE (household_id, investment_id, com_date, note)
);

ALTER TABLE investment_stock_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE investment_stock_events FORCE ROW LEVEL SECURITY;
CREATE POLICY investment_stock_events_select ON investment_stock_events FOR SELECT
  USING (household_id = app_household_id());
CREATE POLICY investment_stock_events_insert ON investment_stock_events FOR INSERT
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY investment_stock_events_update ON investment_stock_events FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY investment_stock_events_delete ON investment_stock_events FOR DELETE
  USING (household_id = app_household_id() AND app_can_write());
