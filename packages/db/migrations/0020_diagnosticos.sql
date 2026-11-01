-- 0020: erros que a equipe de agentes enxerga (docs/specs/assistente-ia.md, seção 7). Só aditiva.
-- Sem mensagem, corpo, query string, e-mail ou id de família: mensagem de erro pode trazer valor de
-- família. Os CHECK fecham o formato de cada coluna para o banco recusar texto livre.
-- Uma linha por erro e versão: a contagem por commit é o que permite comparar a taxa depois do merge.
CREATE TABLE ops.diagnostics (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fingerprint    text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{32}$'),
  service        text NOT NULL CHECK (service IN ('web', 'worker')),
  source         text NOT NULL
    CHECK (source IN ('render', 'route', 'action', 'proxy', 'client', 'job', 'agent')),
  error_type     text NOT NULL CHECK (error_type ~ '^[A-Za-z][A-Za-z0-9_$]{0,79}$'),
  -- Rota sem parâmetros (/app/metas/[id]) ou nome fixo (job:market-data, agente:metas).
  route          text NOT NULL CHECK (route ~ '^[A-Za-z0-9/_:.\[\]-]{1,200}$'),
  commit         text NOT NULL CHECK (commit ~ '^[A-Za-z0-9._-]{1,64}$'),
  code           text CHECK (code ~ '^[A-Za-z0-9_.-]{1,40}$'),
  -- Só arquivo e linha do nosso código.
  stack          text[] NOT NULL DEFAULT '{}' CHECK (
    cardinality(stack) <= 8
    AND array_to_string(stack, '|') ~ '^[A-Za-z0-9_./()\[\]:|+-]*$'
  ),
  count          integer NOT NULL DEFAULT 1 CHECK (count >= 0),
  -- Teto diário por impressão digital: ver recordDiagnostic.
  day            date NOT NULL,
  day_count      integer NOT NULL DEFAULT 1 CHECK (day_count >= 0),
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  status         text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'resolvido')),
  resolved_at    timestamptz,
  UNIQUE (fingerprint, commit)
);
CREATE INDEX diagnostics_status_idx ON ops.diagnostics(status, last_seen_at DESC);
CREATE INDEX diagnostics_source_day_idx ON ops.diagnostics(source, first_seen_at DESC);
CREATE INDEX diagnostics_commit_idx ON ops.diagnostics(commit);
