-- 0022: dicas por tela, Fase 2 do assistente (docs/specs/assistente-ia.md, §5 e §6). Só aditiva.
--
-- A rotina da madrugada grava aqui o que passou no verificador. Quem lê é a família inteira; "Entendi"
-- e "Fazer agora" são de quem pode escrever. `destination` é a tela que resolve a dica, sempre uma da
-- lista: o modelo escolhe, nunca escreve um endereço.
CREATE TABLE household_insights (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id  text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  screen        text NOT NULL CHECK (screen IN ('painel', 'lancamentos', 'calendario', 'metas',
                  'viagens', 'investimentos', 'proventos', 'aposentadoria', 'reserva', 'dividas')),
  destination   text NOT NULL CHECK (destination IN ('painel', 'lancamentos', 'calendario', 'metas',
                  'viagens', 'investimentos', 'proventos', 'aposentadoria', 'reserva', 'dividas')),
  title         text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 90),
  body          text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 400),
  why           text NOT NULL CHECK (length(trim(why)) BETWEEN 1 AND 600),
  priority      smallint NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  status        text NOT NULL DEFAULT 'ativa'
                  CHECK (status IN ('ativa', 'feita', 'dispensada', 'vencida')),
  day           date NOT NULL,
  expires_on    date NOT NULL,
  dedupe_key    text NOT NULL CHECK (length(dedupe_key) BETWEEN 1 AND 160),
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz,
  decided_by    text REFERENCES "user"(id) ON DELETE SET NULL,
  UNIQUE (household_id, id),
  UNIQUE (household_id, day, dedupe_key)
);
CREATE INDEX household_insights_active_idx
  ON household_insights(household_id, screen, priority) WHERE status = 'ativa';
CREATE INDEX household_insights_dedupe_idx ON household_insights(household_id, dedupe_key, day);

ALTER TABLE household_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_insights FORCE ROW LEVEL SECURITY;
CREATE POLICY household_insights_select ON household_insights FOR SELECT
  USING (household_id = app_household_id());
CREATE POLICY household_insights_insert ON household_insights FOR INSERT
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY household_insights_update ON household_insights FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
