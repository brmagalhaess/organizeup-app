-- Transferência entre contas da casa reconhecida no extrato do banco (ADR-0042). As duas linhas, a saída
-- numa conta e a entrada na outra, viram uma transferência só. A marca de importação de cada linha fica
-- guardada aqui: é ela que impede a linha de entrar de novo na próxima atualização, e é com ela que os dois
-- lançamentos voltam se a família disser que não era transferência.
ALTER TABLE account_transfers
  ADD COLUMN from_fingerprint text,
  ADD COLUMN to_fingerprint text,
  -- O que o banco escreveu na entrada. O da saída fica em `note`.
  ADD COLUMN to_note text;
