# ADR-0007 — Reserva e patrimônio

Status: aceito (2026-10-30)

## Decisão

- **A reserva não tem saldo próprio.** Ela é a soma das contas marcadas (`earmarks`, propósito `reserva`).
  Assim não existe um segundo valor para divergir do saldo real das contas. A conta entra inteira.
- **Meta = meses × gasto essencial** (`emergency_fund`). O gasto essencial vem, nesta ordem:
  1. do valor informado pela família;
  2. da média dos últimos 3 meses fechados que tiveram gasto;
  3. do mês atual com as previsões, para quem acabou de começar.

  Conta tudo que está em categoria essencial, inclusive compras no cartão e parcelas de dívida.

- **Patrimônio líquido** = contas ativas + bens − dívidas ativas − cartões (`summarizeNetWorth`). No cartão
  entram faturas em aberto e parcelas futuras, porque a compra parcelada já é uma obrigação assumida.
  Na dívida entra só a amortização em aberto: juros futuros ainda não são devidos.
- **Bens** (`assets`) têm valor informado pela família, com a data dele. Dívida ligada ao bem só mostra quanto
  já é da família; ela conta uma vez, na lista de dívidas.
- **Foto mensal** (`net_worth_snapshots`, uma por família e mês). Bens não têm histórico, então a evolução
  não pode ser recalculada depois. O worker atualiza a foto do mês todo dia às 02:30 e ao iniciar, e a tela
  de patrimônio também, então a última foto do mês vira o fechamento. Família sem nenhum valor não gera foto.
- **Uma só fonte para web e worker**: `netWorthInputs` em `packages/db` lê os dados, sempre dentro de
  `withHousehold`, e `summarizeNetWorth` em `packages/domain` faz a conta. O worker percorre as famílias
  por `listHouseholdIds`, uma transação por família, e não registra a mensagem de erro, que pode ter valores.

## Fora do escopo por enquanto

Parte de uma conta como reserva, histórico de valor de cada bem, correção automática de bens e carteira de
investimentos (Fase 4). Uma conta do tipo investimento entra pelo saldo informado.
