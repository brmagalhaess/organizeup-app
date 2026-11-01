-- 0027: anexos de dívida, aceite para ler arquivos com IA e plano diário de saída das dívidas. Só
-- aditiva (ADR-0019).

-- Arquivos ficam no banco, sem serviço novo: até 10 MB por arquivo, e a cota de 50 MB por família é
-- conferida na gravação. Listagens nunca selecionam `content`. `debt_id` nulo: arquivo que ainda não
-- virou dívida. Apagar a dívida ou a família apaga os arquivos em cascata. `extracted` é rascunho da
-- leitura: nada dele entra em cálculo antes de a família confirmar (regra 7).
CREATE TABLE debt_documents (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id  text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  debt_id       text,
  file_name     text NOT NULL CHECK (length(trim(file_name)) BETWEEN 1 AND 200),
  media_type    text NOT NULL CHECK (media_type IN (
                  'application/pdf', 'image/png', 'image/jpeg', 'text/csv',
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
  size_bytes    integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  content       bytea NOT NULL,
  sha256        text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  status        text NOT NULL DEFAULT 'guardado'
                  CHECK (status IN ('guardado', 'lendo', 'lido', 'falhou', 'confirmado')),
  extracted     jsonb,
  created_by    text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id),
  UNIQUE (household_id, sha256),
  CHECK (octet_length(content) = size_bytes),
  FOREIGN KEY (household_id, debt_id) REFERENCES debts(household_id, id) ON DELETE CASCADE
);
CREATE INDEX debt_documents_debt_idx ON debt_documents(household_id, debt_id);
CREATE INDEX debt_documents_recent_idx ON debt_documents(household_id, created_at DESC);

ALTER TABLE debt_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY debt_documents_select ON debt_documents FOR SELECT
  USING (household_id = app_household_id());
CREATE POLICY debt_documents_insert ON debt_documents FOR INSERT
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY debt_documents_update ON debt_documents FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY debt_documents_delete ON debt_documents FOR DELETE
  USING (household_id = app_household_id() AND app_can_write());

-- Aceite para o arquivo inteiro ir ao serviço de IA: tratamento novo, além do aceite do assistente.
-- Tabela própria, e não coluna em household_settings, porque há leituras de todas as colunas daquela
-- tabela, e a web pode subir antes de o worker migrar. Retirar o aceite apaga a linha.
CREATE TABLE household_file_consents (
  household_id  text PRIMARY KEY REFERENCES household(id) ON DELETE CASCADE,
  version       text NOT NULL CHECK (length(version) BETWEEN 1 AND 40),
  accepted_by   text REFERENCES "user"(id) ON DELETE SET NULL,
  accepted_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE household_file_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_file_consents FORCE ROW LEVEL SECURITY;
CREATE POLICY household_file_consents_select ON household_file_consents FOR SELECT
  USING (household_id = app_household_id());
CREATE POLICY household_file_consents_insert ON household_file_consents FOR INSERT
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY household_file_consents_update ON household_file_consents FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY household_file_consents_delete ON household_file_consents FOR DELETE
  USING (household_id = app_household_id() AND app_can_write());

-- Plano de saída calculado pelo agente `dividas`, um por dia. Fica fora de household_reports porque
-- um tipo novo lá exigiria trocar a CHECK de `kind`, e isso não é aditivo (regra 3). Dado derivado:
-- reescrito na mesma data ao rodar de novo.
CREATE TABLE debt_plan_reports (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id  text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  day           date NOT NULL,
  title         text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  summary       text NOT NULL CHECK (length(trim(summary)) BETWEEN 1 AND 2000),
  data          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id),
  UNIQUE (household_id, day)
);

ALTER TABLE debt_plan_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt_plan_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY debt_plan_reports_select ON debt_plan_reports FOR SELECT
  USING (household_id = app_household_id());
CREATE POLICY debt_plan_reports_insert ON debt_plan_reports FOR INSERT
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY debt_plan_reports_update ON debt_plan_reports FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
