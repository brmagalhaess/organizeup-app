-- 0018: painel do serviço com gerência do sistema (ADR-0016). Só aditiva.

-- Bloqueio de conta e suspensão de família. Quem confere: web (requireSession/requireTenant e login).
ALTER TABLE "user" ADD COLUMN blocked_at timestamptz;
ALTER TABLE household ADD COLUMN suspended_at timestamptz;

-- Alvo do registro quando a ação é sobre uma conta. Só o id, sem nome nem e-mail.
ALTER TABLE ops.admin_access ADD COLUMN target_user_id text;
CREATE INDEX admin_access_action_idx ON ops.admin_access(action, at DESC);

-- Chaves do sistema: tudo desligado por padrão, então linha ausente é o comportamento normal.
--   manutencao, cadastro_fechado, agente_desligado:<agente>, aviso:<id>.
-- Só o painel grava (ou_admin); web e worker leem. O texto dos avisos não leva dado pessoal.
CREATE TABLE ops.feature_flags (
  key         text PRIMARY KEY CHECK (key ~ '^[a-z0-9_:-]{1,80}$'),
  enabled     boolean NOT NULL DEFAULT false,
  value       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text
);

-- Fotografia diária da plataforma: uma linha por dia, só contagens. O worker percorre as famílias
-- uma a uma e grava aqui para o painel não varrer dados de família.
CREATE TABLE ops.platform_stats (
  day              date PRIMARY KEY,
  households       integer NOT NULL DEFAULT 0 CHECK (households >= 0),
  users            integer NOT NULL DEFAULT 0 CHECK (users >= 0),
  active_7d        integer NOT NULL DEFAULT 0 CHECK (active_7d >= 0),
  active_30d       integer NOT NULL DEFAULT 0 CHECK (active_30d >= 0),
  use_entries      integer NOT NULL DEFAULT 0 CHECK (use_entries >= 0),
  use_investments  integer NOT NULL DEFAULT 0 CHECK (use_investments >= 0),
  use_goals        integer NOT NULL DEFAULT 0 CHECK (use_goals >= 0),
  use_trips        integer NOT NULL DEFAULT 0 CHECK (use_trips >= 0),
  use_retirement   integer NOT NULL DEFAULT 0 CHECK (use_retirement >= 0),
  computed_at      timestamptz NOT NULL DEFAULT now()
);
