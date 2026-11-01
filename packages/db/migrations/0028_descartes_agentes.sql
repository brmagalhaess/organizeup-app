-- 0028: descartes do verificador por dia e agente, para o painel do serviço. Só aditiva.
--
-- Tabela à parte, e não coluna em ops.agent_runs: a web lê as rodadas em toda tela do painel e na Ops
-- API, e pode subir antes do worker aplicar esta migração. Sem esta tabela, a contagem só fica zerada.
-- Só contagem, nada de texto nem de família. Grants no migrador: só ou_worker grava.
CREATE TABLE ops.agent_discards (
  day        date NOT NULL,
  agent      text NOT NULL CHECK (agent ~ '^[a-z_-]{1,40}$'),
  discarded  integer NOT NULL DEFAULT 0 CHECK (discarded >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, agent)
);
