-- 0010: memória e relatórios dos agentes de engenharia. Schema `ops`: sem dados pessoais e sem tenant.
-- Agentes só alcançam estas tabelas pela Ops API, que recusa texto com aparência de dado pessoal.

CREATE TABLE ops.agent_memory (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent          text NOT NULL CHECK (agent ~ '^[a-z0-9-]{1,40}$'),
  kind           text NOT NULL CHECK (kind IN ('fato', 'decisao', 'licao', 'preferencia')),
  content        text NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 2000),
  source_issue   text CHECK (length(source_issue) <= 40),
  -- Quando uma memória substitui outra, a antiga deixa de aparecer nas buscas.
  superseded_by  bigint REFERENCES ops.agent_memory(id),
  search         tsvector GENERATED ALWAYS AS (to_tsvector('portuguese', content)) STORED,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ops_agent_memory_search_idx ON ops.agent_memory USING gin(search);
CREATE INDEX ops_agent_memory_agent_idx ON ops.agent_memory(agent, created_at DESC);

CREATE TABLE ops.reports (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('saude', 'semanal', 'incidente', 'custos', 'produto')),
  period      text NOT NULL CHECK (length(period) BETWEEN 1 AND 40),
  agent       text NOT NULL CHECK (agent ~ '^[a-z0-9-]{1,40}$'),
  title       text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- Um relatório por tipo e período: reenviar atualiza, não duplica.
  UNIQUE (kind, period)
);
CREATE INDEX ops_reports_created_idx ON ops.reports(created_at DESC);
