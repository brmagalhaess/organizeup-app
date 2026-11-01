-- 0024: memória da família e base de conhecimento, Fase 4 do assistente
-- (docs/specs/assistente-ia.md, §3, e ADR-0018). Só aditiva.
--
-- A busca é por texto em português, sem embeddings, e não depende de acento: "previdencia" acha
-- "previdência". O texto dos trechos fica em packages/db/src/knowledge-seed.ts e o migrador carrega.

CREATE FUNCTION sem_acento(texto text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  AS $$ SELECT translate(texto,
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC') $$;

-- O que a família pediu para o assistente lembrar. Lê quem é da família; muda quem pode escrever.
-- Quem é substituída aponta para a nova: apagar a nova leva junto as antigas, para o texto apagado
-- não sobreviver numa versão anterior. O texto não leva nome nem valor: a ferramenta recusa ou troca
-- antes de gravar.
CREATE TABLE household_memories (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id  text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('fato', 'preferencia', 'objetivo')),
  content       text NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 300),
  source        text NOT NULL DEFAULT 'conversa' CHECK (source IN ('conversa', 'familia')),
  confidence    smallint NOT NULL DEFAULT 2 CHECK (confidence BETWEEN 1 AND 3),
  expires_on    date,
  superseded_by text,
  search        tsvector GENERATED ALWAYS AS (to_tsvector('portuguese', sem_acento(content))) STORED,
  created_by    text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id),
  FOREIGN KEY (household_id, superseded_by)
    REFERENCES household_memories (household_id, id) ON DELETE CASCADE
);
CREATE INDEX household_memories_active_idx
  ON household_memories(household_id, created_at DESC) WHERE superseded_by IS NULL;
CREATE INDEX household_memories_superseded_idx
  ON household_memories(household_id, superseded_by) WHERE superseded_by IS NOT NULL;

ALTER TABLE household_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_memories FORCE ROW LEVEL SECURITY;
CREATE POLICY household_memories_select ON household_memories FOR SELECT
  USING (household_id = app_household_id());
CREATE POLICY household_memories_insert ON household_memories FOR INSERT
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY household_memories_update ON household_memories FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY household_memories_delete ON household_memories FOR DELETE
  USING (household_id = app_household_id() AND app_can_write());

-- Global como market_quotes: regra pública, nada que ligue um trecho a uma família. Grants no migrador:
-- todos leem, só ou_worker grava, ninguém apaga. Todo trecho tem fonte, endereço e data de revisão.
-- Sem coluna `embedding`: pgvector não está disponível em todos os bancos (ver ADR-0018).
CREATE TABLE knowledge_chunks (
  id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  slug         text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,80}$'),
  topic        text NOT NULL CHECK (length(trim(topic)) BETWEEN 1 AND 40),
  title        text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  content      text NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 1200),
  source_name  text NOT NULL CHECK (length(trim(source_name)) BETWEEN 1 AND 160),
  source_url   text NOT NULL CHECK (source_url ~ '^https://[^[:space:]]+$'),
  reviewed_on  date NOT NULL,
  search       tsvector GENERATED ALWAYS AS (
                 setweight(to_tsvector('portuguese', sem_acento(title)), 'A')
                 || setweight(to_tsvector('portuguese', sem_acento(topic || ' ' || content)), 'B')
               ) STORED
);
CREATE INDEX knowledge_chunks_search_idx ON knowledge_chunks USING gin (search);
