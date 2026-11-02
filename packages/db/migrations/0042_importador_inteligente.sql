-- 0042: importador inteligente (ADR-0030). Lote de arquivos, cada arquivo com seu conteúdo e o que foi
-- entendido nele, e cada item com a proposta de destino. Só aditiva, publicada antes do código.
--
-- `payload` e `fields` são rascunho: nada neles entra em cálculo antes de a família aprovar (regra 7). O que
-- foi aprovado continua vivo em `transactions`, `debts` e nas outras tabelas: `result_id` é só o vínculo,
-- sem FK, para apagar o lote não apagar o que a família aprovou. O conteúdo do arquivo fica no banco como em
-- `debt_documents`, e listagem nunca seleciona `content`.

CREATE TABLE smart_imports (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id  text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'enviando'
                  CHECK (status IN ('enviando', 'na_fila', 'lendo', 'revisao', 'concluido')),
  -- A pessoa pediu IA ao começar. O portão é conferido de novo antes de cada chamada.
  use_ai        boolean NOT NULL DEFAULT false,
  -- Lote do admin do serviço com a liberação desligada. É o único que o worker aceita nessa fase.
  preview       boolean NOT NULL DEFAULT false,
  created_by    text REFERENCES "user"(id) ON DELETE SET NULL,
  queued_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id)
);
CREATE INDEX smart_imports_recent_idx ON smart_imports(household_id, created_at DESC);

ALTER TABLE smart_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE smart_imports FORCE ROW LEVEL SECURITY;
CREATE POLICY smart_imports_select ON smart_imports FOR SELECT
  USING (household_id = app_household_id());
CREATE POLICY smart_imports_insert ON smart_imports FOR INSERT
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY smart_imports_update ON smart_imports FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY smart_imports_delete ON smart_imports FOR DELETE
  USING (household_id = app_household_id() AND app_can_write());

CREATE TABLE smart_import_files (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id  text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  import_id     text NOT NULL,
  position      smallint NOT NULL CHECK (position BETWEEN 0 AND 9),
  file_name     text NOT NULL CHECK (length(trim(file_name)) BETWEEN 1 AND 200),
  media_type    text NOT NULL CHECK (media_type IN (
                  'application/pdf', 'image/png', 'image/jpeg', 'text/csv', 'text/plain',
                  'application/xml', 'application/x-ofx',
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
  size_bytes    integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  content       bytea NOT NULL,
  sha256        text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  status        text NOT NULL DEFAULT 'na_fila'
                  CHECK (status IN ('na_fila', 'lendo', 'lido', 'falhou')),
  doc_type      text CHECK (doc_type ~ '^[a-z0-9_]{1,40}$'),
  -- Quem emitiu: banco, loja, administradora. Empresa, nunca pessoa.
  issuer        text CHECK (length(issuer) <= 80),
  confidence    text CHECK (confidence IN ('alta', 'media', 'baixa')),
  method        text CHECK (method IN ('regras', 'modelo')),
  failure       text CHECK (failure ~ '^[a-z_]{1,40}$'),
  -- Quantas vezes começou a ser lido. Arquivo que derruba quem lê para na segunda tentativa.
  read_attempts smallint NOT NULL DEFAULT 0 CHECK (read_attempts >= 0),
  -- A comparação já olhou este arquivo: depois disso, marcar e desmarcar é da pessoa.
  reviewed      boolean NOT NULL DEFAULT false,
  truncated     boolean NOT NULL DEFAULT false,
  -- Campos extraídos do documento, sem CPF nem CNPJ. É o que os agentes leem depois de aprovado.
  fields        jsonb NOT NULL DEFAULT '[]',
  -- O que não foi entendido, em frases curtas.
  notes         jsonb NOT NULL DEFAULT '[]',
  -- Conta e cartão escolhidos para o arquivo inteiro. Sem FK: conta apagada só some da sugestão.
  account_id    text,
  card_id       text,
  -- A família aprovou guardar como documento. É o que libera os campos aos agentes.
  attached_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id),
  UNIQUE (household_id, import_id, sha256),
  UNIQUE (household_id, import_id, position),
  CHECK (octet_length(content) = size_bytes),
  FOREIGN KEY (household_id, import_id) REFERENCES smart_imports(household_id, id) ON DELETE CASCADE
);
CREATE INDEX smart_import_files_sha_idx ON smart_import_files(household_id, sha256);

ALTER TABLE smart_import_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE smart_import_files FORCE ROW LEVEL SECURITY;
CREATE POLICY smart_import_files_select ON smart_import_files FOR SELECT
  USING (household_id = app_household_id());
CREATE POLICY smart_import_files_insert ON smart_import_files FOR INSERT
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY smart_import_files_update ON smart_import_files FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY smart_import_files_delete ON smart_import_files FOR DELETE
  USING (household_id = app_household_id() AND app_can_write());

CREATE TABLE smart_import_items (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id  text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  import_id     text NOT NULL,
  file_id       text NOT NULL,
  position      integer NOT NULL CHECK (position >= 0),
  destination   text NOT NULL CHECK (destination IN (
                  'lancamento', 'compra_cartao', 'operacao', 'provento', 'divida', 'consorcio',
                  'renda', 'previsao', 'meta', 'documento')),
  status        text NOT NULL DEFAULT 'proposto'
                  CHECK (status IN ('proposto', 'gravado', 'falhou')),
  selected      boolean NOT NULL DEFAULT false,
  -- A pessoa viu o item na tela, ou confirmou "Marcar todos" com a contagem. Sem isso não grava.
  seen          boolean NOT NULL DEFAULT false,
  duplicate     text NOT NULL DEFAULT 'novo' CHECK (duplicate IN ('novo', 'possivel', 'ja_lancado')),
  -- Código do porquê, e o arquivo do lote que tem o mesmo item.
  duplicate_reason text CHECK (duplicate_reason ~ '^[a-z_]{1,40}$'),
  duplicate_file_id text,
  confidence    text NOT NULL CHECK (confidence IN ('alta', 'media', 'baixa')),
  excerpt       text CHECK (length(excerpt) <= 300),
  payload       jsonb NOT NULL,
  failure       text CHECK (failure ~ '^[a-z_]{1,40}$'),
  result_table  text CHECK (result_table ~ '^[a-z_]{1,40}$'),
  result_id     text,
  approved_by   text REFERENCES "user"(id) ON DELETE SET NULL,
  approved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id),
  UNIQUE (household_id, file_id, position),
  FOREIGN KEY (household_id, import_id) REFERENCES smart_imports(household_id, id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, file_id) REFERENCES smart_import_files(household_id, id) ON DELETE CASCADE
);
CREATE INDEX smart_import_items_import_idx ON smart_import_items(household_id, import_id);
-- Teto de itens em aberto por família: a conta é feita a cada leitura e a cada envio.
CREATE INDEX smart_import_items_open_idx ON smart_import_items(household_id)
  WHERE status <> 'gravado';

ALTER TABLE smart_import_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE smart_import_items FORCE ROW LEVEL SECURITY;
CREATE POLICY smart_import_items_select ON smart_import_items FOR SELECT
  USING (household_id = app_household_id());
CREATE POLICY smart_import_items_insert ON smart_import_items FOR INSERT
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY smart_import_items_update ON smart_import_items FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY smart_import_items_delete ON smart_import_items FOR DELETE
  USING (household_id = app_household_id() AND app_can_write());

-- Aceite por escopo: mandar qualquer arquivo ao serviço de IA não é o mesmo que mandar um contrato de dívida.
-- O de dívidas segue em household_file_consents, e um não abre o outro. Tabela nova porque a chave daquela é
-- só a família, e trocar a chave não é aditivo.
CREATE TABLE household_file_scopes (
  household_id  text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  scope         text NOT NULL CHECK (scope IN ('importador')),
  version       text NOT NULL CHECK (length(version) BETWEEN 1 AND 40),
  accepted_by   text REFERENCES "user"(id) ON DELETE SET NULL,
  accepted_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, scope)
);

ALTER TABLE household_file_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_file_scopes FORCE ROW LEVEL SECURITY;
CREATE POLICY household_file_scopes_select ON household_file_scopes FOR SELECT
  USING (household_id = app_household_id());
CREATE POLICY household_file_scopes_insert ON household_file_scopes FOR INSERT
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY household_file_scopes_update ON household_file_scopes FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY household_file_scopes_delete ON household_file_scopes FOR DELETE
  USING (household_id = app_household_id() AND app_can_write());

-- Liberação em etapas: nunca rodou em Linux nem com IA real. Desligada, só o admin do serviço usa, e o worker
-- recusa o lote de quem não é admin. Quem liga é o painel, com auditoria.
INSERT INTO ops.feature_flags (key, enabled) VALUES ('smart_import_enabled', false)
  ON CONFLICT (key) DO NOTHING;
