-- 0039: intenções de viagem (ADR-0026). Lugares que a família quer conhecer. É dado informado (regra 7):
-- o agente de viagens lê e nunca muda nem apaga. Só o aceite de uma sugestão, feito pela família, grava
-- `fulfilled_at` e `fulfilled_trip_id`. Migração só aditiva, publicada antes do código.

CREATE TABLE trip_intentions (
  id                 text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id       text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  -- Destino do catálogo, ou nome livre com região: nunca os dois, e nome livre nunca sem região.
  destination_id     text REFERENCES trip_destination_templates(id),
  custom_name        text CHECK (custom_name IS NULL OR length(trim(custom_name)) BETWEEN 1 AND 80),
  custom_region      text CHECK (custom_region IS NULL OR custom_region IN
    ('brasil_perto', 'brasil', 'america_sul', 'america_norte', 'europa', 'asia_oceania')),
  -- Mês do ano (1 a 12), sem ano: o agente escolhe o ano em que dá tempo de guardar.
  preferred_month    smallint CHECK (preferred_month BETWEEN 1 AND 12),
  days               smallint CHECK (days BETWEEN 1 AND 60),
  fulfilled_at       timestamptz,
  fulfilled_trip_id  text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id),
  CHECK ((destination_id IS NULL) <> (custom_name IS NULL)),
  CHECK ((custom_name IS NULL) = (custom_region IS NULL)),
  -- Apagar a viagem não apaga a intenção: ela fica atendida, sem o vínculo.
  FOREIGN KEY (household_id, fulfilled_trip_id) REFERENCES trips(household_id, id)
    ON DELETE SET NULL (fulfilled_trip_id)
);
CREATE INDEX trip_intentions_household_id_idx ON trip_intentions(household_id);
-- O mesmo lugar uma vez só por família: repetido viraria duas sugestões do mesmo destino.
CREATE UNIQUE INDEX trip_intentions_destination_unique
  ON trip_intentions(household_id, destination_id) WHERE destination_id IS NOT NULL;
CREATE UNIQUE INDEX trip_intentions_custom_name_unique
  ON trip_intentions(household_id, lower(trim(custom_name))) WHERE custom_name IS NOT NULL;

ALTER TABLE trip_intentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_intentions FORCE ROW LEVEL SECURITY;
CREATE POLICY trip_intentions_select ON trip_intentions FOR SELECT USING (household_id = app_household_id());
CREATE POLICY trip_intentions_insert ON trip_intentions FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY trip_intentions_update ON trip_intentions FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY trip_intentions_delete ON trip_intentions FOR DELETE USING (household_id = app_household_id() AND app_can_write());
