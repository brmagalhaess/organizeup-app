# ADR-0004 — Dinheiro, datas e arredondamento

Status: aceito (2026-10-29)

- **Tipo**: `decimal.js` (`Money`, precisão 34). `number` nunca representa valor monetário.
- **Banco**: valores `numeric(14,2)`; quantidades, cotas e índices `numeric(20,8)`.
- **Arredondamento**: `ROUND_HALF_EVEN` (bancário), **só na borda** (gravar/exibir). Cálculos
  intermediários sem arredondar.
- **Parcelas**: divide em centavos com `ROUND_DOWN`; o resíduo vai para a **última** parcela, de modo
  que a soma é exatamente o total (invariante testada com fast-check).
- **Datas**: vencimentos e eventos são **datas civis** (`date`) no fuso do household
  (`household_settings.timezone`, padrão `America/Sao_Paulo`). Instantes técnicos em `timestamptz`.
- **Idades**: a partir de mês/ano de nascimento (dado mínimo; LGPD).
- **Fórmulas oficiais** (INSS, IRRF, 13º, férias) virão de `fiscal_parameters` com vigência, e cada
  regra terá fixtures com fonte citada (tabelas da Receita/INSS, Calculadora do Cidadão).
- Mudanças em `packages/domain/**` exigem revisão do fundador (CODEOWNERS).
