-- 0003: schema `ops` — dados operacionais SEM PII, lidos pelos agentes via Ops API.

CREATE SCHEMA ops;

-- Cada processo (web/worker) registra no boot o commit que está rodando.
CREATE TABLE ops.deployments (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  service     text NOT NULL CHECK (service IN ('web', 'worker')),
  commit      text NOT NULL,
  hostname    text,
  started_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ops_deployments_started_idx ON ops.deployments(started_at DESC);

-- Último sinal de vida de cada worker.
CREATE TABLE ops.worker_heartbeats (
  worker_id     text PRIMARY KEY,
  commit        text NOT NULL,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  info          jsonb NOT NULL DEFAULT '{}'::jsonb
);
