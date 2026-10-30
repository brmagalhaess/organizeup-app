-- 0013: agente de categorização do extrato. A memória e o relatório são da família, sob RLS.
-- Para a equipe de agentes vão só contagens, em ops.categorization_stats, sem descrição nem família.

-- O que o agente aprendeu: para cada estabelecimento, a categoria que a família confirmou.
CREATE TABLE category_memory (
  household_id  text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('receita', 'despesa')),
  merchant      text NOT NULL CHECK (length(merchant) BETWEEN 1 AND 120),
  category_id   text NOT NULL,
  source        text NOT NULL CHECK (source IN ('agente', 'familia')),
  hits          integer NOT NULL DEFAULT 1 CHECK (hits > 0),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, kind, merchant),
  FOREIGN KEY (household_id, category_id) REFERENCES categories(household_id, id) ON DELETE CASCADE
);

-- Relatórios dos agentes do produto, para consulta futura do assistente da família.
CREATE TABLE household_reports (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id  text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  agent         text NOT NULL CHECK (agent ~ '^[a-z0-9-]{1,40}$'),
  kind          text NOT NULL CHECK (kind IN ('importacao')),
  period        text NOT NULL CHECK (length(period) BETWEEN 1 AND 60),
  title         text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  summary       text NOT NULL CHECK (length(summary) BETWEEN 1 AND 2000),
  data          jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, kind, period)
);
CREATE INDEX household_reports_recent_idx ON household_reports(household_id, created_at DESC);

CREATE TABLE ops.categorization_stats (
  day                 date PRIMARY KEY,
  imports             integer NOT NULL DEFAULT 0,
  row_count           integer NOT NULL DEFAULT 0,
  from_memory         integer NOT NULL DEFAULT 0,
  from_words          integer NOT NULL DEFAULT 0,
  unmatched           integer NOT NULL DEFAULT 0,
  corrected           integer NOT NULL DEFAULT 0,
  categories_created  integer NOT NULL DEFAULT 0
);

-- ---------- RLS ----------
ALTER TABLE category_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE category_memory FORCE ROW LEVEL SECURITY;
CREATE POLICY category_memory_select ON category_memory FOR SELECT USING (household_id = app_household_id());
CREATE POLICY category_memory_insert ON category_memory FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY category_memory_update ON category_memory FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY category_memory_delete ON category_memory FOR DELETE USING (household_id = app_household_id() AND app_can_write());

ALTER TABLE household_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY household_reports_select ON household_reports FOR SELECT USING (household_id = app_household_id());
CREATE POLICY household_reports_insert ON household_reports FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY household_reports_update ON household_reports FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY household_reports_delete ON household_reports FOR DELETE USING (household_id = app_household_id() AND app_can_write());
