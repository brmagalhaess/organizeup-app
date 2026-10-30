-- 0015: viagens (Fase 6). Custos informados pela família; a data entra no calendário como evento.

CREATE TABLE trips (
  id                 text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id       text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  destination        text NOT NULL CHECK (length(trim(destination)) BETWEEN 1 AND 80),
  start_on           date NOT NULL,
  end_on             date,
  saved              numeric(14,2) NOT NULL DEFAULT 0 CHECK (saved >= 0),
  calendar_event_id  text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id),
  CHECK (end_on IS NULL OR end_on >= start_on),
  FOREIGN KEY (household_id, calendar_event_id) REFERENCES calendar_events(household_id, id)
    ON DELETE SET NULL (calendar_event_id)
);
CREATE INDEX trips_household_id_idx ON trips(household_id);

CREATE TABLE trip_costs (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id  text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  trip_id       text NOT NULL,
  kind          text NOT NULL CHECK (kind IN
    ('passagem', 'hospedagem', 'alimentacao', 'transporte', 'passeios', 'outros')),
  amount        numeric(14,2) NOT NULL CHECK (amount > 0),
  per_person    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (household_id, trip_id) REFERENCES trips(household_id, id) ON DELETE CASCADE
);
CREATE INDEX trip_costs_trip_idx ON trip_costs(household_id, trip_id);

CREATE TABLE trip_people (
  household_id  text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  trip_id       text NOT NULL,
  person_id     text NOT NULL,
  PRIMARY KEY (household_id, trip_id, person_id),
  FOREIGN KEY (household_id, trip_id) REFERENCES trips(household_id, id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, person_id) REFERENCES people(household_id, id) ON DELETE CASCADE
);

ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips FORCE ROW LEVEL SECURITY;
CREATE POLICY trips_select ON trips FOR SELECT USING (household_id = app_household_id());
CREATE POLICY trips_insert ON trips FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY trips_update ON trips FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY trips_delete ON trips FOR DELETE USING (household_id = app_household_id() AND app_can_write());

ALTER TABLE trip_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_costs FORCE ROW LEVEL SECURITY;
CREATE POLICY trip_costs_select ON trip_costs FOR SELECT USING (household_id = app_household_id());
CREATE POLICY trip_costs_insert ON trip_costs FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY trip_costs_update ON trip_costs FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY trip_costs_delete ON trip_costs FOR DELETE USING (household_id = app_household_id() AND app_can_write());

ALTER TABLE trip_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_people FORCE ROW LEVEL SECURITY;
CREATE POLICY trip_people_select ON trip_people FOR SELECT USING (household_id = app_household_id());
CREATE POLICY trip_people_insert ON trip_people FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY trip_people_update ON trip_people FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY trip_people_delete ON trip_people FOR DELETE USING (household_id = app_household_id() AND app_can_write());
