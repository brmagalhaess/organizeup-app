# Aporte fora de "Despesas"

Decisão do fundador em 2026-11-02: guardar dinheiro não é gasto. Aporte em investimento sai de "Despesas" em todas as telas. O
porquê das escolhas está no ADR-0027; aqui ficam o levantamento e o que cada tela mostra.

## Levantamento: toda soma de despesa

| Onde                                                     | O que soma hoje                                          | Aporte dentro?                                                                 | Depois                                                                    |
| -------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `summarizeMonth` (`cashflow.ts`)                         | toda entrada `despesa`, feita e prevista; toda `receita` | sim, e resgate em receita                                                      | quatro fluxos: receita, despesa, aporte, resgate                          |
| `expensesByCategory`, `spendingByCategory`               | despesa por categoria, com cartão aberto                 | sim                                                                            | sem aporte; aporte em `savingsLines`                                      |
| `incomeByCategory`, `incomeLines`                        | receita por categoria                                    | resgate dentro                                                                 | sem resgate                                                               |
| `monthlySeries`                                          | `summarizeMonth` por mês; só `surplusInputs` usa         | não (o chamador já tirava)                                                     | a regra fica dentro, sem filtro no chamador                               |
| `monthsAverage`, `fromFirstMovement`                     | médias e início do histórico                             | sim                                                                            | aporte não dilui a média; mês só com aporte conta como mês com dado       |
| `largestExpenses`                                        | maiores gastos do mês                                    | sim: um aporte grande vira "maior gasto"                                       | sem aporte                                                                |
| `plannedForMonth`                                        | régua do previsto × realizado                            | sim, com parcela de meta                                                       | aporte previsto à parte                                                   |
| `projectMonths`, `buildFluxo`                            | sobra projetada e acumulado                              | sim                                                                            | resultado sem aporte; acumulado desconta o aporte previsto                |
| `buildResumo`, `buildCategorias`, `buildAnual`           | figuras, comparação, evolução, ranking                   | sim                                                                            | figuras e colunas de aporte, resgate e sobra depois de aportar            |
| `savingsMoved`, `barRows` (`saving`)                     | quanto das despesas é aporte: nota do painel             | a nota existe porque está dentro                                               | sai: o número ganha lugar próprio                                         |
| `activityByAccount`, `plannedNetByAccount`               | receitas e despesas por conta; saldo previsto            | sim                                                                            | conta separa aporte; **saldo previsto continua igual, centavo a centavo** |
| `essentialBaseline`, via `reserveInputs` e `loadReserve` | despesa em categoria `essential` e compra de cartão      | só se a família marcou aporte como essencial                                   | aporte nunca entra, mesmo marcado                                         |
| `largestCategory` (`plan-view.ts`)                       | maior soma de `despesa` do último mês fechado            | sim: o plano sugeria cortar 10% do aporte                                      | sem aporte                                                                |
| `surplusInputs`                                          | excedente e gasto médio de 12 meses                      | não, se a categoria tiver o nome certo; sim em operação em categoria renomeada | regra única, e mede também o que já é aportado por mês                    |
| `suggestAllocation`                                      | divide o excedente                                       | ignora o que já está sendo aportado                                            | conta o aporte real antes de dividir                                      |
| `buildMonthEntries`                                      | junta lançamentos, previsões e compromissos              | lista, não soma                                                                | igual: a lista continua mostrando o aporte                                |
| `resumo_do_mes`, `listar_lancamentos` (assistente)       | gasto, por categoria, `soma_despesas`                    | sim                                                                            | campos próprios                                                           |
| `calendarMonth`                                          | resumo do mês e saldo diário                             | sim no resumo                                                                  | resumo separa; **saldo diário igual**                                     |

## Levantamento: quem consome esses números

- **Painel** (`/app`, `loadOverview`): resumo, comparação com o mês anterior, gráfico de evolução e tabela dele, categorias, contas, notas.
- **Lançamentos** (`/app/lancamentos`, `loadMonth`): resumo e lista.
- **Categorias** (`/app/categorias`): lista as categorias de sistema junto das outras.
- **Calendário** (`/app/calendario`): "Entra", "Sai", resultado. O saldo diário vem das entradas, não do resumo.
- **Relatórios** (`run-relatorios.ts`, `/app/relatorios`, PDF, CSV, `ver_relatorio`, parágrafo "O que mudou"): resumo, categorias, fluxo, anual.
- **Reserva** (`/app/reserva`, `reserveInputs`, `loadReserve`), **Aposentadoria** (`/app/aposentadoria`, `currentDividendPlan`,
  `run-aposentadoria.ts`, média de gastos em `planDividendRetirement`), **Plano** (`monthlyPlan`, `largestCategory`), **Metas** e
  **Viagens** (orçamentos de `suggestAllocation`), **Dívidas** (`allocation.debt`).
- **Assistente e dicas:** `resumo_do_mes`, `listar_lancamentos`, `ver_plano_aposentadoria`, `ver_reserva`, instruções. As dicas da madrugada
  só leem pelas ferramentas, então herdam o conserto.
- **E-mails e admin:** nenhum soma despesa de família. Conferido em `email-templates.ts`, `email.ts`, `admin*.ts`, `ops.ts`,
  `ops-data.ts` e `diagnostics.ts`. Exportar dados entrega os lançamentos como estão.

## O que não muda

Saldo de conta, extrato, fatura, conciliação, saldo diário do calendário, previsão de saldo do painel e valor de qualquer lançamento.
Nenhum lançamento é regravado: a mudança é de leitura. O que a família informou fica como está (regra 7).

## O que cada tela mostra

- **Três números:** receitas, despesas e aportes. Resultado = receitas − despesas. "Aportado" e "Sobrou depois de aportar"
  (resultado − aportes) em texto. Resgate aparece à parte, como "Voltou para as contas".
- **Painel:** os quatro blocos de sempre, mais uma faixa com Aportado, Sobrou depois de aportar e, quando houver, Voltou para as
  contas. Categorias ganham o bloco "Aportes". Cada conta diz quanto aportou. Mês só com aporte conta como mês com movimento. A nota
  única explica a mudança uma vez, para quem tem aporte, até alguém que pode gravar fechar.
- **Lançamentos:** o resumo ganha os mesmos números, e a lista continua mostrando o aporte, com a etiqueta "Aporte" ou "Resgate".
- **Categorias:** as de sistema dizem que ficam fora de despesas e receitas e não oferecem "essencial".
- **Calendário:** Receitas, Despesas e, quando houver, Aportes.
- **Relatórios:** resumo, categorias, fluxo e anual com as colunas novas; ver "Relatórios já fechados" no ADR-0027.
- **Assistente:** campos `aportado`, `resgatado` e `sobrou_depois_de_aportar`, e uma regra nas instruções.
- **Reserva e Aposentadoria:** mesmas telas; a de Aposentadoria diz quanto já é aportado por mês.

## Estados

- **Mês sem aporte:** a faixa nova não aparece, e o painel fica como antes.
- **Mês só com aporte:** não é mês vazio. O relatório continua existindo.
- **Mês futuro:** aporte previsto, com "previsto" no rótulo.
- **Relatório de antes da mudança que ainda não foi regenerado:** aviso de que despesas ainda incluem aportes.
- **Operação sem conta:** não saiu dinheiro de conta, então não entra em "Aportado". A seção Investimentos continua somando pelas operações.

## Família de prova

Números, antes e depois linha a linha, no fim do ADR-0027. Teste: `packages/agents/test/aporte-fora-de-despesas.integration.test.ts`.
