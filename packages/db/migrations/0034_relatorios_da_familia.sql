-- 0034: relatórios da família (ADR-0021). Só aditiva. Publicada antes do código: enquanto ninguém grava
-- aqui, nada muda para a família.
--
-- O agente `relatorios` guarda um relatório por família, tipo e período: `AAAA-MM` no mês e `AAAA` no
-- ano. `data` e `message_key`/`message_params` têm só valores e chaves: quem escreve a frase é a tela,
-- no idioma de quem lê. `kind` é checado pelo formato, não por lista: tipo novo não pede trocar CHECK,
-- o que a regra 3 não deixaria.
--
-- `source_hash` é a assinatura do que a família lançou no período: é por ela que o mês fechado sabe que
-- mudou. `revised_at` é o "atualizado em" do mês fechado que regenerou. `what_changed` é o parágrafo
-- opcional escrito com IA, e `narrated_at` marca que a chamada já aconteceu: no máximo uma por relatório.
--
-- Quando a família apaga tudo o que havia num período, a linha sai: relatório vazio não fica na tela.
-- Grants no migrador (todas as tabelas de public).
CREATE TABLE household_statements (
  id                  text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id        text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  kind                text NOT NULL CHECK (kind ~ '^[a-z_]{1,40}$'),
  period              text NOT NULL CHECK (period ~ '^[0-9]{4}(-(0[1-9]|1[0-2]))?$'),
  status              text NOT NULL DEFAULT 'parcial' CHECK (status IN ('parcial', 'fechado')),
  data                jsonb NOT NULL DEFAULT '{}',
  message_key         text CHECK (length(message_key) <= 80),
  message_params      jsonb,
  source_hash         text CHECK (length(source_hash) <= 128),
  what_changed        text CHECK (length(trim(what_changed)) BETWEEN 1 AND 900),
  what_changed_locale text CHECK (length(what_changed_locale) <= 10),
  narrated_at         timestamptz,
  generated_at        timestamptz NOT NULL DEFAULT now(),
  closed_at           timestamptz,
  revised_at          timestamptz,
  UNIQUE (household_id, id),
  UNIQUE (household_id, kind, period)
);

ALTER TABLE household_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_statements FORCE ROW LEVEL SECURITY;
CREATE POLICY household_statements_select ON household_statements FOR SELECT
  USING (household_id = app_household_id());
CREATE POLICY household_statements_insert ON household_statements FOR INSERT
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY household_statements_update ON household_statements FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY household_statements_delete ON household_statements FOR DELETE
  USING (household_id = app_household_id() AND app_can_write());
