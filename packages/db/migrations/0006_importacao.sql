-- 0006: importação de extratos (Fase 2, parte 3).
-- O arquivo não é guardado. Fica só o lote, para desfazer, e a identidade de cada linha,
-- para reimportar sem duplicar. O lote não guarda nome de arquivo, que pode conter dados da conta.

CREATE TABLE import_batches (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id  text NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  account_id    text NOT NULL,
  source        text NOT NULL CHECK (source IN ('ofx', 'csv')),
  row_count     integer NOT NULL CHECK (row_count >= 0),
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id),
  FOREIGN KEY (household_id, account_id) REFERENCES accounts(household_id, id),
  CHECK (period_start <= period_end)
);
CREATE INDEX import_batches_household_id_idx ON import_batches(household_id);

ALTER TABLE transactions ADD COLUMN import_fingerprint text;
ALTER TABLE transactions ADD COLUMN import_batch_id text;

-- Uma linha de extrato entra no máximo uma vez por conta. NULL fica de fora: lançamentos manuais.
ALTER TABLE transactions ADD CONSTRAINT transactions_import_fingerprint_key
  UNIQUE (household_id, account_id, import_fingerprint);
ALTER TABLE transactions ADD CONSTRAINT transactions_import_batch_fkey
  FOREIGN KEY (household_id, import_batch_id) REFERENCES import_batches(household_id, id)
  ON DELETE SET NULL (import_batch_id);

-- ---------- RLS ----------
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY import_batches_select ON import_batches FOR SELECT USING (household_id = app_household_id());
CREATE POLICY import_batches_insert ON import_batches FOR INSERT WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY import_batches_update ON import_batches FOR UPDATE
  USING (household_id = app_household_id() AND app_can_write())
  WITH CHECK (household_id = app_household_id() AND app_can_write());
CREATE POLICY import_batches_delete ON import_batches FOR DELETE USING (household_id = app_household_id() AND app_can_write());
