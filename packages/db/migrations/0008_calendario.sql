-- 0008: compromissos do calendário (Fase 2, parte 5).
-- Vencimentos não ficam aqui: o calendário os lê das previsões, parcelas e faturas.

CREATE TABLE calendar_events (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id  text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  title         text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  event_date    date NOT NULL,
  -- Repete todo ano na mesma data, como um aniversário.
  yearly        boolean NOT NULL DEFAULT false,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id)
);
CREATE INDEX calendar_events_household_date_idx ON calendar_events(household_id, event_date);

-- ---------- RLS ----------
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events FORCE ROW LEVEL SECURITY;
CREATE POLICY calendar_events_select ON calendar_events FOR SELECT USING (household_id = app_household_id());
CREATE POLICY calendar_events_insert ON calendar_events FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY calendar_events_update ON calendar_events FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY calendar_events_delete ON calendar_events FOR DELETE USING (household_id = app_household_id() AND app_can_write());
