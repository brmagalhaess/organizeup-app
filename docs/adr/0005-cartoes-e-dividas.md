# ADR-0005 — Cartões e dívidas

Status: aceito (2026-10-30)

## Decisão

- **Cartão é tabela própria** (`credit_cards`), não um tipo de `accounts`. Cartão não tem saldo: a compra
  não mexe em conta nenhuma até a fatura ser paga. Isso substitui o que o plano-mestre previa para
  `accounts` e evita alterar a restrição de `accounts.type`, já que migrações são só aditivas.
- **Compra guarda o valor total** (`card_purchases`). Parcelas e faturas são calculadas em
  `packages/domain/src/card.ts`. A fatura é identificada pelo mês de **vencimento**, e uma compra no dia do
  fechamento ainda entra na fatura que está fechando.
- **Pagar a fatura cria um lançamento** (`card_statement_payments` liga os dois). Apagar o lançamento reabre
  a fatura. Compra com parcela em fatura paga não pode ser apagada nem criada numa fatura paga, e as datas
  do cartão não mudam depois da primeira fatura paga, porque o cálculo mudaria faturas já quitadas.
- **Parcelas de dívida são gravadas** (`debt_installments`), porque juros e amortização são fixados no
  cálculo. São a fonte única das previsões de dívida. Pagar cria um lançamento; apagá-lo devolve a parcela
  para em aberto (`ON DELETE SET NULL (transaction_id)`).
- **Fluxo do mês**: faturas e parcelas em aberto entram em `buildMonthEntries` como `ScheduledEntry`, pela
  data de vencimento. Depois de pagas, só o lançamento conta. Nada é contado duas vezes.
- **Para onde vai o dinheiro** abre a fatura pelas categorias das compras (`spendingByCategory`).
- **Ordem de quitação** (`simulatePayoff`) é estimativa mês a mês com a parcela atual como mínimo. Não altera
  nenhuma parcela. Em dívidas com parcela informada os juros já estão embutidos, então a taxa só ordena.

## Fora do escopo por enquanto

Estorno e crédito na fatura, pagamento parcial de fatura, juros de fatura atrasada, amortização extra de
dívida e indexadores (IPCA, TR, CDI). Editar uma compra: exclua e lance de novo.
