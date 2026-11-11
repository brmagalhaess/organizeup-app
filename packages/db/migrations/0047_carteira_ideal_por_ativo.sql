-- 0047: carteira ideal e referências de preço por ativo (ADR-0012). Só operações aditivas.
--
-- Três campos informados pela família em cada investimento, para a tabela completa da carteira:
--   book_value_per_share  valor patrimonial por ação ou cota (VPA/VP), base do P/VP;
--   target_price          preço alvo ou teto, base do potencial de valorização;
--   target_percent        fatia ideal do ativo na carteira (0 a 100), base do aporte necessário.
-- Todos opcionais: sem eles a coluna correspondente fica em branco.
ALTER TABLE investments
  ADD COLUMN book_value_per_share numeric(20, 8) CHECK (book_value_per_share IS NULL OR book_value_per_share > 0),
  ADD COLUMN target_price numeric(20, 8) CHECK (target_price IS NULL OR target_price > 0),
  ADD COLUMN target_percent numeric(5, 2) CHECK (target_percent IS NULL OR (target_percent >= 0 AND target_percent <= 100));
