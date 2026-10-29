-- 0002: primeiras tabelas de domínio (tenant = household) com RLS fail-closed.
--
-- Regras (ver ADR-0002 e AGENTS.md):
--  * toda tabela de domínio tem household_id NOT NULL e FORCE ROW LEVEL SECURITY;
--  * leitura: household_id = current_setting('app.household_id', true);
--  * escrita: papel owner|adult, ou 'system' quando a conexão é do worker;
--  * referências entre tabelas de tenant usam FK composta (household_id, id),
--    porque checagens de FK ignoram RLS.

-- Funções auxiliares (STABLE, sem SECURITY DEFINER).
CREATE FUNCTION app_household_id() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.household_id', true), '') $$;

CREATE FUNCTION app_role() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.role', true), '') $$;

CREATE FUNCTION app_can_write() RETURNS boolean
  LANGUAGE sql STABLE AS $$
    SELECT app_role() IN ('owner', 'adult')
        OR (app_role() = 'system' AND current_user = 'ou_worker')
  $$;

-- Pessoas da família (com ou sem login). Fonte da tela "família".
CREATE TABLE people (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id  text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  relation      text NOT NULL CHECK (relation IN ('titular', 'conjuge', 'filho', 'pai_mae', 'outro')),
  birth_month   smallint CHECK (birth_month BETWEEN 1 AND 12),
  birth_year    smallint CHECK (birth_year BETWEEN 1900 AND 2100),
  user_id       text REFERENCES "user"(id) ON DELETE SET NULL,
  ir_dependent  boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id)
);
CREATE INDEX people_household_id_idx ON people(household_id);
CREATE UNIQUE INDEX people_household_user_uniq ON people(household_id, user_id) WHERE user_id IS NOT NULL;

-- Configurações do household (1:1). Onboarding mínimo; o resto é progressivo por módulo.
CREATE TABLE household_settings (
  household_id       text PRIMARY KEY REFERENCES household(id) ON DELETE CASCADE,
  timezone           text NOT NULL DEFAULT 'America/Sao_Paulo',
  currency           text NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  city               text,
  state              char(2),
  country            char(2) NOT NULL DEFAULT 'BR',
  primary_person_id  text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- FK composta: só pode apontar para uma pessoa do MESMO household.
  FOREIGN KEY (household_id, primary_person_id) REFERENCES people(household_id, id)
);

-- Trilha de auditoria por household (append-only).
CREATE TABLE audit_log (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  household_id   text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  actor_user_id  text,
  actor_kind     text NOT NULL CHECK (actor_kind IN ('user', 'system', 'admin')),
  action         text NOT NULL,
  entity         text NOT NULL,
  entity_id      text,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_household_created_idx ON audit_log(household_id, created_at DESC);

-- ---------- RLS ----------
ALTER TABLE people ENABLE ROW LEVEL SECURITY;
ALTER TABLE people FORCE ROW LEVEL SECURITY;
CREATE POLICY people_select ON people FOR SELECT USING (household_id = app_household_id());
CREATE POLICY people_insert ON people FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY people_update ON people FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY people_delete ON people FOR DELETE USING (household_id = app_household_id() AND app_can_write());

ALTER TABLE household_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY household_settings_select ON household_settings FOR SELECT USING (household_id = app_household_id());
CREATE POLICY household_settings_insert ON household_settings FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY household_settings_update ON household_settings FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
-- Só o owner lê a trilha; qualquer membro (ou o worker) registra; ninguém altera/apaga.
CREATE POLICY audit_log_select ON audit_log FOR SELECT USING (household_id = app_household_id() AND app_role() = 'owner');
CREATE POLICY audit_log_insert ON audit_log FOR INSERT WITH CHECK (household_id = app_household_id() AND app_role() IS NOT NULL);
