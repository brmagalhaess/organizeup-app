-- 0019: assistente com IA, Fase 1 (ADR-0018). Só aditiva.

-- Quem está conversando. Vem de withHousehold, como app_household_id().
CREATE FUNCTION app_user_id() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '') $$;

-- ---------- Consentimento e autonomia, por família ----------
-- Sem ai_consent_at nenhuma chamada ao modelo acontece. ai_consent_version guarda a versão da
-- Política aceita. O nível de autonomia só passa a valer quando as ferramentas de escrita chegarem.
ALTER TABLE household_settings
  ADD COLUMN ai_consent_at timestamptz,
  ADD COLUMN ai_consent_version text,
  ADD COLUMN ai_consent_by text REFERENCES "user"(id) ON DELETE SET NULL,
  ADD COLUMN ai_autonomy text NOT NULL DEFAULT 'organizar'
    CHECK (ai_autonomy IN ('sugerir', 'organizar', 'completo'));

-- ---------- Conversas ----------
-- Cada conversa é de uma pessoa: nem o resto da família vê. O RLS confere família E pessoa, e a FK
-- de assistant_messages leva (household_id, user_id), então uma mensagem não entra na conversa de
-- outra pessoa nem pela checagem de FK, que ignora RLS.
CREATE TABLE assistant_threads (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id  text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  user_id       text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  title         text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id),
  UNIQUE (household_id, user_id, id)
);
CREATE INDEX assistant_threads_recent_idx ON assistant_threads(household_id, user_id, updated_at DESC);

CREATE TABLE assistant_messages (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id  text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  user_id       text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  thread_id     text NOT NULL,
  role          text NOT NULL CHECK (role IN ('user', 'assistant')),
  content       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (household_id, user_id, thread_id)
    REFERENCES assistant_threads(household_id, user_id, id) ON DELETE CASCADE
);
CREATE INDEX assistant_messages_thread_idx ON assistant_messages(household_id, thread_id, created_at);

ALTER TABLE assistant_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_threads FORCE ROW LEVEL SECURITY;
CREATE POLICY assistant_threads_select ON assistant_threads FOR SELECT
  USING (household_id = app_household_id() AND user_id = app_user_id());
CREATE POLICY assistant_threads_insert ON assistant_threads FOR INSERT
  WITH CHECK (household_id = app_household_id() AND user_id = app_user_id() AND app_can_write());
CREATE POLICY assistant_threads_update ON assistant_threads FOR UPDATE
  USING (household_id = app_household_id() AND user_id = app_user_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND user_id = app_user_id() AND app_can_write());
CREATE POLICY assistant_threads_delete ON assistant_threads FOR DELETE
  USING (household_id = app_household_id() AND user_id = app_user_id() AND app_can_write());

-- Mensagem não muda: sem política de UPDATE e DELETE. Some junto com a conversa, pela FK.
ALTER TABLE assistant_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY assistant_messages_select ON assistant_messages FOR SELECT
  USING (household_id = app_household_id() AND user_id = app_user_id());
CREATE POLICY assistant_messages_insert ON assistant_messages FOR INSERT
  WITH CHECK (household_id = app_household_id() AND user_id = app_user_id() AND app_can_write());

-- ---------- Uso, por família ----------
-- Só contagens. Rota e modelo têm CHECK de formato: nenhum texto de conversa cabe aqui.
CREATE TABLE ai_usage (
  household_id        text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  day                 date NOT NULL,
  route               text NOT NULL CHECK (route ~ '^[a-z_]{1,40}$'),
  model               text NOT NULL CHECK (model ~ '^[a-z0-9.-]{1,80}$'),
  calls               integer NOT NULL DEFAULT 0 CHECK (calls >= 0),
  input_tokens        bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens       bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cache_read_tokens   bigint NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cache_write_tokens  bigint NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  cost_usd            numeric(12,6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, day, route, model)
);

ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_usage_select ON ai_usage FOR SELECT USING (household_id = app_household_id());
CREATE POLICY ai_usage_insert ON ai_usage FOR INSERT
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY ai_usage_update ON ai_usage FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());

-- ---------- Somas da plataforma ----------
-- Sem família: é daqui que sai o gasto do mês contra o teto. Quem grava: ver grants do migrador.
CREATE TABLE ops.ai_stats (
  day                 date NOT NULL,
  route               text NOT NULL CHECK (route ~ '^[a-z_]{1,40}$'),
  calls               integer NOT NULL DEFAULT 0 CHECK (calls >= 0),
  input_tokens        bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens       bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cache_read_tokens   bigint NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cache_write_tokens  bigint NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  cost_usd            numeric(14,6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, route)
);
