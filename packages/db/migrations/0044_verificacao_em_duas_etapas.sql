-- 0044: verificação em duas etapas (ADR-0034). Só operações aditivas.
--
-- Tabelas do plugin twoFactor do Better Auth. `two_factor_enabled` entra em "user" porque o plugin lê a
-- coluna na sessão; o worker sobe primeiro e migra antes de a web nova chegar (fila do Dokploy é serial).
-- O segredo TOTP e os códigos de reserva chegam cifrados pelo Better Auth com BETTER_AUTH_SECRET; nem o
-- worker nem o painel do serviço leem esta tabela (grants no migrador).
ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS two_factor_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE two_factor (
  id                        text PRIMARY KEY,
  user_id                   text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  secret                    text NOT NULL,
  backup_codes              text NOT NULL,
  verified                  boolean NOT NULL DEFAULT true,
  failed_verification_count integer NOT NULL DEFAULT 0,
  locked_until              timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX two_factor_user_id_key ON two_factor (user_id);
CREATE INDEX two_factor_secret_idx ON two_factor (secret);
