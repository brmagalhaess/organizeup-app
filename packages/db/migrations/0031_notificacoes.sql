-- 0031: central de notificações (decisão do fundador em 2026-11-01, ADR-0015). Só aditiva. Publicada
-- antes do código: enquanto ninguém grava aqui, nada muda para a família.
--
-- O que o agente mudou sozinho aparece aqui, com o antes e o depois em `data`, de onde a tela monta o
-- texto em cada idioma. `title` e `body` guardam a mesma coisa em português, para o que não souber ler
-- `data`. `kind` é checado pelo formato, não por lista: tipo novo não pede trocar CHECK, o que a regra 3
-- não deixaria. `dedupe_key` faz a rodada da noite não repetir o aviso.
--
-- `read_at` é da família, não da pessoa: quem marca, marca para todos. Quem só vê lê, e não marca.
-- Grants no migrador (todas as tabelas de public).
CREATE TABLE household_notifications (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id  text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind ~ '^[a-z_]{1,40}$'),
  title         text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  body          text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 800),
  data          jsonb NOT NULL DEFAULT '{}',
  href          text CHECK (href ~ '^/app(/|$)' AND length(href) <= 200),
  suggestion_id text,
  dedupe_key    text NOT NULL CHECK (length(dedupe_key) BETWEEN 1 AND 200),
  read_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id),
  UNIQUE (household_id, dedupe_key),
  -- A sugestão pode sair (a de viagem é apagada, por exemplo); o aviso do que aconteceu fica.
  FOREIGN KEY (household_id, suggestion_id) REFERENCES household_suggestions(household_id, id)
    ON DELETE SET NULL (suggestion_id)
);
CREATE INDEX household_notifications_recent_idx
  ON household_notifications(household_id, created_at DESC);
-- O sininho conta isto em toda tela do painel.
CREATE INDEX household_notifications_unread_idx
  ON household_notifications(household_id) WHERE read_at IS NULL;

ALTER TABLE household_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY household_notifications_select ON household_notifications FOR SELECT
  USING (household_id = app_household_id());
CREATE POLICY household_notifications_insert ON household_notifications FOR INSERT
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY household_notifications_update ON household_notifications FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
