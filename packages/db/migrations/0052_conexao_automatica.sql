-- 0052: atualização automática da conexão com bancos (ADR-0038). Só operações aditivas.
--
-- Pedido do fundador em 2026-11-11: depois de ligadas as contas e os cartões, o que cair no banco entra
-- sozinho. A chave do cofre só existe na web, então a rodada roda lá: quando a pessoa abre o sistema e quando
-- o Paperclip acorda o agente `bancos`. Cada conexão anota quando rodou, para não repetir a busca a cada tela.

ALTER TABLE bank_connections
  -- A pessoa pode desligar e voltar a trazer só pela conferência.
  ADD COLUMN auto_enabled boolean NOT NULL DEFAULT true,
  -- Última rodada automática: é também a trava entre duas rodadas ao mesmo tempo.
  ADD COLUMN auto_ran_at timestamptz;
