-- 0011: aceite dos Termos e da Política de Privacidade. Pertence à pessoa, não à família: fica fora da RLS
-- de tenant, como as demais tabelas do Better Auth (ADR-0002). Contas anteriores ficam sem registro.

CREATE TABLE legal_acceptance (
  user_id      text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  version      text NOT NULL,
  accepted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, version)
);
