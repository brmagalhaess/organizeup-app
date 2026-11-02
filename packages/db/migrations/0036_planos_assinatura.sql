-- 0036: planos e assinatura (ADR-0023, docs/specs/planos-e-assinatura.md). Só aditiva. Publicada antes do
-- código: `billing_enabled` nasce desligada, e enquanto ninguém lê estas tabelas nada muda para a família.
-- Os grants vêm junto, no migrador, neste mesmo commit: sem eles, ou_app herda o GRANT geral sobre o catálogo.
-- Catálogo só o painel grava; assinatura só o worker grava; a família só lê.

-- Catálogo global, sem dado de família. Preço não é editado: preço novo é linha nova, com `on_sale`, e a
-- antiga fica aqui com `on_sale = false`, porque quem assinou por ela continua nela. `item` diz o que o preço
-- libera; `stripe_price_id` chega pelo script de criar preços, e sem ele o item ainda não está à venda.
CREATE TABLE billing_catalog (
  id               text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  item             text NOT NULL CHECK (item ~ '^[a-z_]{1,40}(:[A-Za-z0-9_]{1,40})?$'),
  cycle            text NOT NULL CHECK (cycle IN ('mes', 'ano')),
  amount           numeric(14,2) NOT NULL CHECK (amount > 0),
  currency         text NOT NULL DEFAULT 'BRL' CHECK (currency ~ '^[A-Z]{3}$'),
  stripe_price_id  text UNIQUE CHECK (stripe_price_id ~ '^price_[A-Za-z0-9_]{1,200}$'),
  on_sale          boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX billing_catalog_on_sale_uniq ON billing_catalog(item, cycle) WHERE on_sale;

-- Valores da especificação, seção 1: hipótese, editável no painel. Anual: 10 meses.
-- `familia_mensagens:300` é o que a Família completa paga a mais para ir de 100 a 300 mensagens: a diferença
-- entre os dois degraus do assistente (ver ADR-0023).
INSERT INTO billing_catalog (item, cycle, amount) VALUES
  ('base:50', 'mes', 9.90),                  ('base:50', 'ano', 99.00),
  ('base:200', 'mes', 19.90),                ('base:200', 'ano', 199.00),
  ('base:ilimitado', 'mes', 29.90),          ('base:ilimitado', 'ano', 299.00),
  ('modulo:investimentos', 'mes', 9.90),     ('modulo:investimentos', 'ano', 99.00),
  ('modulo:aposentadoria', 'mes', 9.90),     ('modulo:aposentadoria', 'ano', 99.00),
  ('modulo:dividas', 'mes', 7.90),           ('modulo:dividas', 'ano', 79.00),
  ('modulo:metas', 'mes', 6.90),             ('modulo:metas', 'ano', 69.00),
  ('assistente:30', 'mes', 6.90),            ('assistente:30', 'ano', 69.00),
  ('assistente:100', 'mes', 14.90),          ('assistente:100', 'ano', 149.00),
  ('assistente:300', 'mes', 29.90),          ('assistente:300', 'ano', 299.00),
  ('moeda:BRL', 'mes', 4.90),                ('moeda:BRL', 'ano', 49.00),
  ('moeda:USD', 'mes', 4.90),                ('moeda:USD', 'ano', 49.00),
  ('moeda:EUR', 'mes', 4.90),                ('moeda:EUR', 'ano', 49.00),
  ('familia', 'mes', 44.90),                 ('familia', 'ano', 449.00),
  ('familia_mensagens:300', 'mes', 15.00),   ('familia_mensagens:300', 'ano', 150.00);

-- Contas conectadas: preço por conta, com quantidade na assinatura, só mensal (docs/specs/conexao-de-contas.md).
-- Nasce fora de venda: invisível e impossível de comprar até a conexão com bancos existir.
INSERT INTO billing_catalog (item, cycle, amount, on_sale) VALUES ('contas_conectadas', 'mes', 19.90, false);

-- Situação da família (1:1). O webhook é a fonte da verdade: esta tabela é o espelho local, e o acesso lê
-- daqui, sem chamar a Stripe a cada tela. Só ids, datas, valores de catálogo e códigos: nenhum dado pessoal.
CREATE TABLE household_subscriptions (
  household_id            text PRIMARY KEY REFERENCES household(id) ON DELETE CASCADE,
  -- Cortesia: tudo liberado, sem Stripe, até `courtesy_until` (sem data, até o fundador decidir).
  courtesy                boolean NOT NULL DEFAULT false,
  courtesy_until          timestamptz,
  courtesy_reason         text CHECK (courtesy_reason ~ '^[a-z_]{1,40}$'),
  trial_ends_at           timestamptz,
  stripe_customer_id      text UNIQUE CHECK (stripe_customer_id ~ '^cus_[A-Za-z0-9_]{1,200}$'),
  stripe_subscription_id  text UNIQUE CHECK (stripe_subscription_id ~ '^sub_[A-Za-z0-9_]{1,200}$'),
  -- Situação da Stripe, como veio. Por formato, e não por lista: trocar CHECK não seria aditivo.
  status                  text CHECK (status ~ '^[a-z_]{1,40}$'),
  cycle                   text CHECK (cycle IN ('mes', 'ano')),
  -- `[{ "price": "price_...", "item": "modulo:dividas", "amount": "7.90", "quantity": 1 }]`.
  items                   jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(items) = 'array'),
  current_period_start    timestamptz,
  current_period_end      timestamptz,
  cancel_at_period_end    boolean NOT NULL DEFAULT false,
  canceled_at             timestamptz,
  -- Troca marcada para o fim do ciclo (downgrade por schedule).
  stripe_schedule_id      text CHECK (stripe_schedule_id ~ '^sub_sched_[A-Za-z0-9_]{1,200}$'),
  scheduled_items         jsonb CHECK (jsonb_typeof(scheduled_items) = 'array'),
  scheduled_cycle         text CHECK (scheduled_cycle IN ('mes', 'ano')),
  scheduled_at            timestamptz,
  -- Último evento de schedule aplicado, e o último schedule que acabou: evento dele não ressuscita a troca.
  schedule_event_at       timestamptz,
  schedule_ended_id       text CHECK (schedule_ended_id ~ '^sub_sched_[A-Za-z0-9_]{1,200}$'),
  -- Primeira cobrança paga: daqui saem os 7 dias do arrependimento (CDC, art. 49).
  first_paid_at           timestamptz,
  refunded_at             timestamptz,
  payment_failed_at       timestamptz,
  -- Último evento aplicado à assinatura. Evento mais velho que isto chegou fora de ordem e não muda o estado.
  last_event_at           timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- Quem já existe entra com cortesia (spec, seção 5). Vem antes da RLS: esta linha não tem família no contexto.
INSERT INTO household_subscriptions (household_id, courtesy, courtesy_reason)
  SELECT id, true, 'familia_existente' FROM household;

ALTER TABLE household_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY household_subscriptions_select ON household_subscriptions FOR SELECT
  USING (household_id = app_household_id());
-- A família nunca grava o próprio plano: a escrita é do worker, que aplica os eventos da Stripe.
CREATE POLICY household_subscriptions_worker_insert ON household_subscriptions FOR INSERT
  WITH CHECK (household_id = app_household_id() AND app_role() = 'system' AND current_user = 'ou_worker');
CREATE POLICY household_subscriptions_worker_update ON household_subscriptions FOR UPDATE
  USING (household_id = app_household_id() AND app_role() = 'system' AND current_user = 'ou_worker')
  WITH CHECK (household_id = app_household_id() AND app_role() = 'system' AND current_user = 'ou_worker');
-- Só para o gatilho abaixo, que roda como dono da tabela. Sem isto, com dono sem BYPASSRLS, o FORCE recusaria.
CREATE POLICY household_subscriptions_seed ON household_subscriptions FOR INSERT TO CURRENT_USER
  WITH CHECK (true);

-- Toda família nova ganha a linha, venha de onde vier. Com a chave desligada entra como cortesia, porque ainda
-- "já existia" quando a cobrança começar; com a chave ligada, começa o teste de 7 dias. SECURITY DEFINER porque a
-- família nasce sem contexto de tenant, pela conexão do Better Auth. Falhar aqui não pode impedir o cadastro:
-- sem a linha o acesso cai em cortesia (`resolveAccess`), e o aviso fica no log do banco.
CREATE FUNCTION household_subscription_seed() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  charging boolean;
BEGIN
  SELECT enabled INTO charging FROM ops.feature_flags WHERE key = 'billing_enabled';
  IF coalesce(charging, false) THEN
    INSERT INTO public.household_subscriptions (household_id, trial_ends_at)
      VALUES (NEW.id, now() + interval '7 days');
  ELSE
    INSERT INTO public.household_subscriptions (household_id, courtesy, courtesy_reason)
      VALUES (NEW.id, true, 'antes_da_cobranca');
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'household_subscription_seed falhou: %', SQLSTATE;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION household_subscription_seed() FROM PUBLIC;
CREATE TRIGGER household_subscription_seed AFTER INSERT ON household
  FOR EACH ROW EXECUTE FUNCTION household_subscription_seed();

-- Mensagens ao assistente no mês. É contador, e não contagem das conversas, porque conversa é de cada pessoa
-- e apagar uma não devolve a mensagem. `month` no fuso da família. Lançamentos não ficam aqui: ver `usage_month`.
CREATE TABLE household_usage (
  household_id  text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  month         text NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  messages      integer NOT NULL DEFAULT 0 CHECK (messages >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, month)
);
ALTER TABLE household_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY household_usage_select ON household_usage FOR SELECT
  USING (household_id = app_household_id());
CREATE POLICY household_usage_insert ON household_usage FOR INSERT
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY household_usage_update ON household_usage FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());

-- Mês em que o lançamento conta para o limite. Preenchida só no que a pessoa lança ou importa: parcela, fatura,
-- aporte, recorrência e o que o sistema gera ficam nulos. Apagar ou desfazer a importação devolve a vaga sozinho.
ALTER TABLE transactions
  ADD COLUMN usage_month text CHECK (usage_month ~ '^\d{4}-(0[1-9]|1[0-2])$');
ALTER TABLE card_purchases
  ADD COLUMN usage_month text CHECK (usage_month ~ '^\d{4}-(0[1-9]|1[0-2])$');
CREATE INDEX transactions_usage_month_idx ON transactions(household_id, usage_month)
  WHERE usage_month IS NOT NULL;
CREATE INDEX card_purchases_usage_month_idx ON card_purchases(household_id, usage_month)
  WHERE usage_month IS NOT NULL;

-- Eventos da Stripe recebidos pela web, um por id: é o que torna o webhook idempotente. O worker aplica. `data`
-- guarda só a lista fechada de campos que `normalizeEvent` extrai, sem e-mail, nome ou endereço do pagador.
CREATE TABLE ops.billing_events (
  id            text PRIMARY KEY CHECK (id ~ '^evt_[A-Za-z0-9_]{1,200}$'),
  type          text NOT NULL CHECK (type ~ '^[a-z_.]{1,80}$'),
  stripe_at     timestamptz NOT NULL,
  livemode      boolean NOT NULL,
  household_id  text,
  customer_id   text CHECK (customer_id ~ '^cus_[A-Za-z0-9_]{1,200}$'),
  data          jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  attempts      integer NOT NULL DEFAULT 0,
  -- Código curto, nunca texto de erro.
  error_code    text CHECK (error_code ~ '^[a-z0-9_]{1,40}$')
);
CREATE INDEX billing_events_pending_idx ON ops.billing_events(stripe_at) WHERE processed_at IS NULL;
CREATE INDEX billing_events_customer_idx ON ops.billing_events(customer_id)
  WHERE household_id IS NOT NULL;

-- Pagamento aberto por família. A web cria o cliente da Stripe antes do pagamento e guarda aqui, porque não
-- grava em `household_subscriptions`. `locked_until` é a trava: a Stripe é chamada fora de transação, e dois
-- cliques não podem abrir duas assinaturas. Só ids e datas.
CREATE TABLE ops.billing_checkouts (
  household_id  text PRIMARY KEY,
  customer_id   text CHECK (customer_id ~ '^cus_[A-Za-z0-9_]{1,200}$'),
  session_id    text CHECK (session_id ~ '^cs_[A-Za-z0-9_]{1,200}$'),
  locked_until  timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Chave de liberação (spec, seção 6). Desligada: todos têm acesso como hoje, e nada cobra.
INSERT INTO ops.feature_flags (key, enabled) VALUES ('billing_enabled', false);
