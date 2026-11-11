-- 0050: conexão com bancos pela Pluggy, com a chave de cada pessoa (ADR-0038). Só operações aditivas.
--
-- Cada pessoa cria a própria conta na Pluggy (plano pessoal, grátis) e informa o Client ID, o Client Secret e os
-- identificadores das conexões. Quem está logado pode guardar até duas chaves: a sua e a de outra pessoa do
-- cadastro (o cônjuge), com a autorização dela. Cada chave pertence a uma pessoa, e cada pessoa tem uma só. O OrganizeUp guarda as chaves cifradas (AES-256-GCM, com a família e a pessoa
-- como dado autenticado) e só as abre quando a própria pessoa pede para buscar os dados. Nunca guarda senha de
-- banco. O que vem da Pluggy passa pela conferência das telas de importar antes de virar lançamento.

CREATE TABLE bank_connections (
  id                   text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id         text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  -- Quem guardou a chave: só este login vê, usa e remove a conexão. Apagar o login leva a conexão junto.
  user_id              text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  -- De quem são as contas: a pessoa do cadastro que criou a chave na Pluggy.
  person_id            text NOT NULL,
  provider             text NOT NULL DEFAULT 'pluggy' CHECK (provider IN ('pluggy')),
  client_id_sealed     text NOT NULL CHECK (length(client_id_sealed) BETWEEN 1 AND 600),
  client_secret_sealed text NOT NULL CHECK (length(client_secret_sealed) BETWEEN 1 AND 600),
  -- Conexões (items) da pessoa na Pluggy. O plano pessoal aceita até 5.
  item_ids             text[] NOT NULL CHECK (cardinality(item_ids) BETWEEN 1 AND 5),
  checked_at           timestamptz,
  -- Só o código do último erro: nada que venha do banco ou identifique a pessoa.
  error_code           text CHECK (length(error_code) <= 40),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id),
  -- Uma chave por pessoa: a mesma conta não chega por dois caminhos.
  UNIQUE (household_id, person_id, provider),
  FOREIGN KEY (household_id, person_id) REFERENCES people(household_id, id) ON DELETE CASCADE
);
CREATE INDEX bank_connections_household_id_idx ON bank_connections(household_id);
CREATE INDEX bank_connections_user_id_idx ON bank_connections(household_id, user_id);

CREATE TABLE bank_connection_accounts (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id  text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  connection_id text NOT NULL,
  item_id       text NOT NULL CHECK (length(item_id) <= 60),
  -- Identificador da conta na Pluggy.
  external_id   text NOT NULL CHECK (length(external_id) <= 60),
  kind          text NOT NULL CHECK (kind IN ('corrente', 'poupanca', 'cartao')),
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  -- Últimos dígitos, para a pessoa reconhecer a conta. Nunca o número inteiro.
  number_tail   text CHECK (length(number_tail) <= 4),
  currency      text NOT NULL DEFAULT 'BRL' CHECK (length(currency) = 3),
  -- Conta do OrganizeUp que recebe os lançamentos. Null: ainda não ligada.
  account_id    text,
  -- Último dia já trazido: a próxima busca começa perto dele.
  synced_on     date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id),
  UNIQUE (household_id, connection_id, external_id),
  FOREIGN KEY (household_id, connection_id)
    REFERENCES bank_connections(household_id, id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, account_id)
    REFERENCES accounts(household_id, id) ON DELETE SET NULL (account_id)
);
CREATE INDEX bank_connection_accounts_household_id_idx ON bank_connection_accounts(household_id);
-- Uma conta do OrganizeUp recebe lançamentos de uma conta do banco só: duas na mesma embaralham a conferência.
CREATE UNIQUE INDEX bank_connection_accounts_account_key
  ON bank_connection_accounts(household_id, account_id) WHERE account_id IS NOT NULL;

-- ---------- RLS ----------
ALTER TABLE bank_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY bank_connections_select ON bank_connections FOR SELECT USING (household_id = app_household_id());
CREATE POLICY bank_connections_insert ON bank_connections FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY bank_connections_update ON bank_connections FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY bank_connections_delete ON bank_connections FOR DELETE USING (household_id = app_household_id() AND app_can_write());

ALTER TABLE bank_connection_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_connection_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY bank_connection_accounts_select ON bank_connection_accounts FOR SELECT USING (household_id = app_household_id());
CREATE POLICY bank_connection_accounts_insert ON bank_connection_accounts FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY bank_connection_accounts_update ON bank_connection_accounts FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY bank_connection_accounts_delete ON bank_connection_accounts FOR DELETE USING (household_id = app_household_id() AND app_can_write());

-- Liberação em etapas: o plano pessoal da Pluggy é para uso próprio, e a tela nunca rodou com chave real.
-- Desligada, só o admin do serviço vê a conexão. Quem liga é o painel, com auditoria.
INSERT INTO ops.feature_flags (key, enabled) VALUES ('bank_feed_enabled', false)
  ON CONFLICT (key) DO NOTHING;
