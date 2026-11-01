-- 0029: preferências da pessoa, começando pelo idioma (ADR-0020). Só aditiva.
--
-- Pertence à pessoa, não à família: fica fora da RLS de tenant, como legal_acceptance (ADR-0002). Na
-- mesma família, cada um escolhe o seu idioma.
--
-- Tabela à parte, e não coluna em "user": o Better Auth lê todas as colunas declaradas naquela tabela,
-- e uma coluna nova derrubaria o login enquanto o worker não migra. Sem esta tabela, vale o cookie.
-- Grants no migrador (todas as tabelas de public).
CREATE TABLE user_preferences (
  user_id    text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  -- Etiqueta curta, não lista fechada: idioma novo não pede trocar CHECK. A web confere os aceitos.
  locale     text NOT NULL CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
