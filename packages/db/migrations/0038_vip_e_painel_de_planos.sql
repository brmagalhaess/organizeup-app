-- 0038: VIP e painel de planos (ADR-0025, docs/specs/planos-e-assinatura.md, seção 9). Só aditiva. Publicada antes do
-- código: enquanto ninguém lê estas colunas, nada muda para a família. Os grants vêm junto, no migrador, neste mesmo
-- commit: sem eles, ou_app e ou_worker herdariam o GRANT geral e a família conseguiria gravar o próprio VIP.

-- Uma concessão é sempre de UMA família. VIP de pessoa é a concessão a uma família de que ela é responsável, presa a
-- ela: enquanto `user_id` for responsável daquela família vale, e deixando de ser para de valer. Não segue a pessoa
-- para outra família e não passa por quem é só membro. Linha nunca é apagada: remover grava `revoked_at`.
CREATE TABLE vip_grants (
  id                text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id      text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  scope             text NOT NULL CHECK (scope IN ('familia', 'pessoa')),
  -- Conta apagada zera o vínculo e a concessão de pessoa para de valer. Nunca vira VIP de família.
  user_id           text REFERENCES "user"(id) ON DELETE SET NULL,
  -- Tudo liberado, ou só `modules` com os limites abaixo. Limite nulo: sem limite.
  full_access       boolean NOT NULL DEFAULT true,
  modules           jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(modules) = 'array'),
  entry_limit       integer CHECK (entry_limit >= 0),
  message_limit     integer CHECK (message_limit >= 0),
  currencies        jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(currencies) = 'array'),
  -- `sem_custo` não passa pela Stripe. `desconto` é cupom na assinatura, e sozinho não libera nada.
  cost              text NOT NULL CHECK (cost IN ('sem_custo', 'desconto')),
  discount_percent  integer CHECK (discount_percent BETWEEN 1 AND 99),
  -- Código de uma lista fechada, e não texto livre: motivo escrito à mão vira nome de pessoa.
  reason            text NOT NULL CHECK (reason ~ '^[a-z_]{1,40}$'),
  -- Sem data: até alguém remover.
  ends_at           timestamptz,
  granted_by        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  revoked_at        timestamptz,
  revoked_by        text,
  CHECK (scope = 'pessoa' OR user_id IS NULL),
  CHECK ((cost = 'desconto') = (discount_percent IS NOT NULL)),
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
-- Uma concessão aberta por família: é isto que resolve duas concessões ao mesmo tempo.
CREATE UNIQUE INDEX vip_grants_open_uniq ON vip_grants(household_id) WHERE revoked_at IS NULL;
CREATE INDEX vip_grants_user_idx ON vip_grants(user_id) WHERE user_id IS NOT NULL;

ALTER TABLE vip_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE vip_grants FORCE ROW LEVEL SECURITY;
-- A família lê a própria linha, porque o acesso é decidido no contexto dela. Nenhuma política de escrita: quem grava é
-- ou_admin, com BYPASSRLS, e ou_app e ou_worker nem têm o grant.
CREATE POLICY vip_grants_select ON vip_grants FOR SELECT
  USING (household_id = app_household_id());

-- Desconto em vigor na assinatura, espelho do que foi aplicado na Stripe. Vem da metadata da assinatura pelo webhook.
-- Vencer o VIP não mexe aqui: o preço só sobe por ação explícita, para ninguém ser cobrado por surpresa.
ALTER TABLE household_subscriptions
  ADD COLUMN discount_percent integer CHECK (discount_percent BETWEEN 1 AND 99);
