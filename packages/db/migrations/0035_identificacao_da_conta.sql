-- 0035: documento de quem tem conta e tipo da conta, pessoa física ou jurídica (ADR-0022). Só aditiva.
-- Publicada antes do código: enquanto ninguém grava aqui, nada muda, e toda conta segue como família.

-- O tipo é do tenant. Em `household`, fora da RLS, porque o convite e o e-mail precisam dele antes de a
-- pessoa entrar. O Drizzle declara a coluna em `householdAccess`, não em `household`: o Better Auth lê todas
-- as colunas declaradas, e o login cairia até esta migração chegar.
ALTER TABLE household
  ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'pf'
  CHECK (account_type IN ('pf', 'pj'));

-- Participação de cada sócio, opcional. É só informação: nada no sistema divide valores por ela.
ALTER TABLE people
  ADD COLUMN IF NOT EXISTS ownership_percent numeric(5,2)
  CHECK (ownership_percent >= 0 AND ownership_percent <= 100);

--
-- Uma linha por conta, com FK em cascata: apagar a conta apaga o documento. Tabela própria e não coluna
-- em `user`, porque o Better Auth lê todas as colunas declaradas ali (ADR-0016 e ADR-0020).
--
-- CPF, CNPJ e razão social só entram cifrados. A razão social também: a de MEI costuma trazer o CPF. Nada
-- aqui abre sem DOCUMENT_ENCRYPTION_KEY, que só a web recebe. `cpf_hash` e `cnpj_hash` são HMAC com chave
-- derivada dela e servem só para achar duplicidade: sem a chave, não dá para testar CPF por força bruta.
--
-- `in_brazil`: true, mora no Brasil; false, outro país, sem documento; null, a pessoa só dispensou o pedido.
CREATE TABLE user_identity (
  user_id                text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  in_brazil              boolean,
  person_type            text CHECK (person_type IN ('pf', 'pj')),
  cpf_encrypted          text,
  cpf_hash               text,
  cnpj_encrypted         text,
  cnpj_hash              text,
  company_name_encrypted text,
  dismissed_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_identity_shape CHECK (
    (person_type IS NULL AND cpf_encrypted IS NULL AND cpf_hash IS NULL
      AND cnpj_encrypted IS NULL AND cnpj_hash IS NULL AND company_name_encrypted IS NULL)
    OR (person_type = 'pf' AND in_brazil IS TRUE AND cpf_encrypted IS NOT NULL AND cpf_hash IS NOT NULL
      AND cnpj_encrypted IS NULL AND cnpj_hash IS NULL AND company_name_encrypted IS NULL)
    OR (person_type = 'pj' AND in_brazil IS TRUE AND cpf_encrypted IS NOT NULL AND cpf_hash IS NOT NULL
      AND cnpj_encrypted IS NOT NULL AND cnpj_hash IS NOT NULL AND company_name_encrypted IS NOT NULL)
  )
);

-- Pessoa física: um CPF, uma conta. Cada pessoa do casal tem a sua conta e o seu CPF, e as duas entram na
-- mesma família pelo convite. Pessoa jurídica: um CNPJ, uma conta. O CPF do responsável não entra no índice:
-- a mesma pessoa pode ter a conta PF e responder por várias empresas, cada uma com a sua conta.
CREATE UNIQUE INDEX user_identity_cpf_hash_key ON user_identity (cpf_hash) WHERE person_type = 'pf';
CREATE UNIQUE INDEX user_identity_cnpj_hash_key ON user_identity (cnpj_hash) WHERE cnpj_hash IS NOT NULL;

-- Da pessoa, não da família: nem o responsável lê o documento de outro membro. Sem `app.user_id` a conexão
-- não vê nada, e não há política de DELETE: a linha só some com a conta. A unicidade vale acima da RLS.
ALTER TABLE user_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_identity FORCE ROW LEVEL SECURITY;
CREATE POLICY user_identity_select ON user_identity FOR SELECT
  USING (user_id = app_user_id());
CREATE POLICY user_identity_insert ON user_identity FOR INSERT
  WITH CHECK (user_id = app_user_id());
CREATE POLICY user_identity_update ON user_identity FOR UPDATE
  USING (user_id = app_user_id())
  WITH CHECK (user_id = app_user_id());
