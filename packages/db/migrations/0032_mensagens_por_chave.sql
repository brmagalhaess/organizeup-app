-- 0032: mensagens dos agentes por chave e valores (ADR-0020, Fase 3). Só aditiva. Publicada antes do
-- código: enquanto ninguém grava aqui, nada muda para a família.
--
-- Na mesma família, cada pessoa tem o seu idioma, então um texto só não basta. `message_key` aponta
-- para o catálogo da web e `message_params` guarda os valores crus, que a tela formata no idioma de
-- quem lê. `title`, `body` e `summary` continuam em português, como reserva: linha antiga, sem chave,
-- mostra o texto gravado, e é ele que o assistente lê.
ALTER TABLE household_suggestions ADD COLUMN IF NOT EXISTS message_key text;
ALTER TABLE household_suggestions ADD COLUMN IF NOT EXISTS message_params jsonb;

ALTER TABLE household_notifications ADD COLUMN IF NOT EXISTS message_key text;
ALTER TABLE household_notifications ADD COLUMN IF NOT EXISTS message_params jsonb;

ALTER TABLE household_reports ADD COLUMN IF NOT EXISTS message_key text;
ALTER TABLE household_reports ADD COLUMN IF NOT EXISTS message_params jsonb;

ALTER TABLE debt_plan_reports ADD COLUMN IF NOT EXISTS message_key text;
ALTER TABLE debt_plan_reports ADD COLUMN IF NOT EXISTS message_params jsonb;

-- O plano mensal da meta é dado derivado: o worker reescreve todo dia, e `plan_note` segue em português.
ALTER TABLE goals ADD COLUMN IF NOT EXISTS plan_note_key text;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS plan_note_params jsonb;
