-- 0001: tabelas do Better Auth (geridas pelo adapter; SEM RLS de tenant — ver ADR-0002).
-- household = plugin `organization` do Better Auth (modelo "organization" -> tabela "household").

CREATE TABLE "user" (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  email           text NOT NULL UNIQUE,
  email_verified  boolean NOT NULL DEFAULT false,
  image           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE household (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  logo        text,
  metadata    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz
);

CREATE TABLE session (
  id                   text PRIMARY KEY,
  expires_at           timestamptz NOT NULL,
  token                text NOT NULL UNIQUE,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  ip_address           text,
  user_agent           text,
  user_id              text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  active_household_id  text
);
CREATE INDEX session_user_id_idx ON session(user_id);

CREATE TABLE account (
  id                        text PRIMARY KEY,
  account_id                text NOT NULL,
  provider_id               text NOT NULL,
  user_id                   text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  access_token              text,
  refresh_token             text,
  id_token                  text,
  access_token_expires_at   timestamptz,
  refresh_token_expires_at  timestamptz,
  scope                     text,
  password                  text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_user_id_idx ON account(user_id);

CREATE TABLE verification (
  id          text PRIMARY KEY,
  identifier  text NOT NULL,
  value       text NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_identifier_idx ON verification(identifier);

CREATE TABLE household_member (
  id            text PRIMARY KEY,
  household_id  text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  user_id       text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, user_id)
);
CREATE INDEX household_member_user_id_idx ON household_member(user_id);

CREATE TABLE household_invitation (
  id            text PRIMARY KEY,
  household_id  text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  email         text NOT NULL,
  role          text,
  status        text NOT NULL DEFAULT 'pending',
  expires_at    timestamptz NOT NULL,
  inviter_id    text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX household_invitation_household_id_idx ON household_invitation(household_id);
