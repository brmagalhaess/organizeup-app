-- 0048: valor patrimonial por ação ou cota junto da cotação (ADR-0012, tabela da carteira). Só aditiva.
--
-- O worker busca o VPA uma vez por dia por ativo, na rodada completa, pela rota de fundamentos do Yahoo
-- (patrimônio líquido ÷ ações emitidas, último trimestre). A carteira usa este valor para o P/VP quando a
-- família não informou o VPA no investimento; o informado vale mais.
ALTER TABLE market_quotes
  ADD COLUMN book_value_per_share numeric(20, 8) CHECK (book_value_per_share IS NULL OR book_value_per_share > 0),
  ADD COLUMN book_value_as_of date;
