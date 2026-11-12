-- 0053: lembretes por e-mail (ADR-0039). Só operações aditivas.
--
-- Pedido do fundador em 2026-11-11: o sistema avisa por e-mail o que vence, o que entra (renda e proventos) e
-- o gasto novo que chegou pelo banco ou por outra pessoa, e uma vez por mês manda o resumo do plano de
-- aposentadoria. A linha guarda a escolha de cada login em cada
-- família e até onde o aviso já foi, para o mesmo gasto não sair em dois e-mails. Sem linha, vale o padrão:
-- tudo ligado. Nada do que vai no e-mail fica guardado aqui.

CREATE TABLE email_reminders (
  id                text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id      text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  user_id           text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  -- Interruptor geral: desligado, nenhum lembrete sai para este login.
  enabled           boolean NOT NULL DEFAULT true,
  -- Contas, faturas e parcelas a pagar.
  bills             boolean NOT NULL DEFAULT true,
  -- Renda prevista para o dia.
  income            boolean NOT NULL DEFAULT true,
  -- Proventos dos ativos da carteira, no dia do pagamento.
  dividends         boolean NOT NULL DEFAULT true,
  -- Gasto novo em conta ou cartão que não foi digitado por este login.
  expenses          boolean NOT NULL DEFAULT true,
  -- Resumo mensal do plano de aposentadoria.
  retirement        boolean NOT NULL DEFAULT true,
  -- Com quantos dias de antecedência o vencimento aparece.
  days_ahead        smallint NOT NULL DEFAULT 3 CHECK (days_ahead BETWEEN 0 AND 7),
  -- Dia do último resumo de vencimentos: um por dia, mesmo que a rodada passe duas vezes.
  daily_sent_on     date,
  -- Até quando os gastos novos já foram avisados.
  expenses_seen_at  timestamptz,
  -- Mês (AAAA-MM) do último resumo da aposentadoria: um por mês.
  retirement_month  char(7),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id),
  UNIQUE (household_id, user_id)
);
CREATE INDEX email_reminders_household_id_idx ON email_reminders(household_id);

-- ---------- RLS ----------
-- Preferência pessoal: cada login vê e muda só a própria linha, inclusive quem só lê a família.
ALTER TABLE email_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_reminders FORCE ROW LEVEL SECURITY;
CREATE POLICY email_reminders_select ON email_reminders FOR SELECT
  USING (household_id = app_household_id() AND user_id = app_user_id());
CREATE POLICY email_reminders_insert ON email_reminders FOR INSERT
  WITH CHECK (household_id = app_household_id() AND user_id = app_user_id());
CREATE POLICY email_reminders_update ON email_reminders FOR UPDATE
  USING (household_id = app_household_id() AND user_id = app_user_id())
  WITH CHECK (household_id = app_household_id() AND user_id = app_user_id());
CREATE POLICY email_reminders_delete ON email_reminders FOR DELETE
  USING (household_id = app_household_id() AND user_id = app_user_id());

-- Liberação em etapas: a Política de Privacidade publicada dizia que dado financeiro não ia em e-mail. O texto
-- muda junto com esta migração, e quem liga para todos é o painel, com auditoria. Desligada, só o admin do
-- serviço recebe e vê a escolha.
INSERT INTO ops.feature_flags (key, enabled) VALUES ('email_reminders_enabled', false)
  ON CONFLICT (key) DO NOTHING;
