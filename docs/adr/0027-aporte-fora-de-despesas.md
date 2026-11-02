# ADR-0027 — Aporte fora de "Despesas"

Status: aceito (2026-11-02). Decisão do fundador: guardar dinheiro não é gasto. Aporte em investimento sai de "Despesas" em todas
as telas.

Muda o que a [spec do painel](../specs/painel.md) dizia em "Aporte é movimentação" e soma ao ADR-0021 (relatórios), ao ADR-0015
(divisão do excedente) e ao ADR-0012 (operação que gera lançamento). Levantamento completo: `docs/specs/aporte-fora-de-despesas.md`.

## Decisão

### Uma definição só

- **`packages/domain/src/savings.ts` responde "isto é dinheiro guardado?".** `savingsDestination` devolve `investimento`, `meta` ou
  nada, e `entryFlow` diz receita, despesa, aporte ou resgate. Toda soma do mês recebe a regra (`SavingsRule`) como argumento
  obrigatório: esquecer não compila.
- **Conta como guardado:** lançamento gerado por operação (`investment_trades.transaction_id`), mesmo que a família troque a categoria
  dele; lançamento na categoria de aportes; parcela de meta, feita ou prevista; lançamento na categoria de metas.
- **Meta é dinheiro guardado, com o mesmo tratamento.** A parcela não some: vira saldo de meta ou entra numa conta da família.
  Excedente e gasto médio já a tiravam (ADR-0015). Reserva não tem categoria própria: é transferência, que nunca foi receita nem
  despesa, ou aporte lançado na categoria de aportes.
- **Resgate é o simétrico do aporte.** O dinheiro já era da família, então não é receita. Entra em "Voltou para as contas". A perna
  de entrada de uma parcela de meta com conta de destino cai no mesmo número: é dinheiro que chega numa conta sem ser renda. Por isso o
  rótulo diz "voltou para as contas", e não "resgate".
- **Identificação da categoria sem nome e sem migração.** `categories.position` guarda o modelo que criou a categoria: 90 para metas,
  91 para aportes. Nada no produto muda esse número, e categoria criada pela família fica com 100. Vale em família com a categoria
  renomeada, traduzida ou em outro idioma. Sem o modelo, como a categoria de receita que `recordTradeCash` cria sob demanda, vale o nome
  de sistema, sem caixa nem acento. Um teste de integração confere as posições contra `category_templates`.
- **Por que não uma coluna `system_key`.** Numa família que já renomeou, a migração só teria a mesma pista, a posição. A coluna exigiria
  `select *` tolerante em toda leitura de `categories` durante o deploy.

### O que não muda

- **Saldo de conta, extrato, fatura, conciliação, saldo diário do calendário e saldo previsto do painel.** Nenhum lançamento é
  regravado, e `plannedNetByAccount` soma os quatro fluxos. O teste de propriedade confere o saldo previsto de cada conta.
- **O que a família informou** (regra 7): renda alvo, aporte digitado, gasto essencial informado, valor e data da meta.

### Três números

Receitas, despesas e aportes. Resultado = receitas − despesas. "Sobrou depois de aportar" = resultado − aportes, a fórmula do
fundador. Resgate fica fora dela e aparece ao lado: quem vende e recompra no mesmo mês vê Aportado e "Voltou para as contas" juntos.

### Compra de cartão na categoria de aportes

Chega ao mês dentro da fatura. `splitCardSavings` separa a parte dela, só para somar: a lista continua mostrando a fatura inteira. A
soma não muda. Se a fatura foi paga em outro mês, a compra fica fora de aportes no mês dela, e o pagamento segue despesa. É o mesmo
limite que `spendingByCategory` sempre teve.

### Operação sem conta

Não saiu dinheiro de conta, então não entra em "Aportado". A seção Investimentos do painel continua somando pelas operações, e a tela
diz a diferença.

### Excedente, reserva e divisão

- **O excedente não sobe.** `surplusInputs` já tirava aporte e meta da conta, por nome. O excedente continua sendo receitas menos
  despesas, antes dos aportes. Só muda em operação cuja categoria tinha sido renomeada, em que a conta antiga errava para menos.
- **O risco real era outro: a divisão ignorava o que já é aportado.** Uma família com 4.000 de excedente que já investe 3.000 tinha os
  3.600 disponíveis divididos como se nada tivesse saído. Agora `investingHabit` mede o hábito (`min(média, mediana)`, aportes menos
  resgates, como o excedente; um pico não vira compromisso, e meta fica fora) e `suggestAllocation` o recebe.
- **O aporte real é a fatia da aposentadoria, e não uma fatia a mais.** Ele não sai do excedente antes de dividir: a sugestão seguida
  mudaria a sugestão do mês seguinte, e metas e viagens oscilariam. Quem segue a sugestão recebe a mesma sugestão. Só o que passa da
  fatia sai das outras: primeiro metas e viagens, depois dívidas e, por último, a reserva. A soma das fatias é sempre o disponível.
- **Sugestão só do que falta.** `aporte_investimento` só nasce se a divisão pedir mais do que a família já faz. A tela de Aposentadoria
  diz quanto já é aportado, e o plano do mês só pede o que passa disso.
- **Projeção.** Sem aporte informado, a projeção usa `allocation.retirement`, que agora nunca fica abaixo do aporte real. Com aporte
  informado, vale o informado.
- **Reserva.** O alvo vem de categorias essenciais. Aporte nunca entra, mesmo em categoria marcada como essencial, e a média só usa
  mês com gasto essencial, então mês só com aporte não dilui nada. A fatia mensal da reserva só encolhe quando o aporte real já comeu
  metas, viagens e dívidas: aí é dinheiro que não existe mais.
- **Plano do mês:** `largestCategory` ignora aporte. Antes, um aporte grande virava "corte 10% do seu maior gasto".

### Relatórios já fechados

- **`STATEMENT_RULE_VERSION` vale 2** e entra na assinatura de resumo, categorias, fluxo e anual. Na primeira rodada, o que está fechado
  nos últimos 12 meses e o anual anterior regeneram pelo caminho de sempre, com `revised_at` e o aviso `aporteSeparado`, que muda o texto
  de "atualizado em". Na rodada seguinte a assinatura bate e nada acontece. Patrimônio, investimentos, proventos, dívidas, metas e
  aposentadoria não mudam com a regra e ficam intactos.
- **O parágrafo "O que mudou" sai,** como em toda regeneração: falava de outros números. `narrated_at` continua marcado, então a
  regeneração não chama o modelo. Um relatório fechado que ainda não tinha parágrafo ganha o único a que já tinha direito.
- **A posição do fim do ano do anual é preservada.** Ela é uma foto que só existe em janeiro.
- **Mais antigo que a janela, ou antes da primeira rodada:** continua como está, com `data.version` 1, e a tela diz que ainda conta
  aportes como despesas. Mês fora dos 12 meses não regenera: a assinatura sairia vazia.
- **Só com aporte:** mês assim continua tendo relatório. Sem isso, a regeneração o apagaria.

### Assistente e dicas

`resumo_do_mes` e `listar_lancamentos` trazem os números à parte, e as instruções dizem para não somar. As dicas da madrugada leem pelas
ferramentas e herdam. Dica gravada antes da mudança vale por até 7 dias e pode citar o número antigo: foi escrita naquele dia e expira
sozinha.

### Nota única no painel

Aparece para quem tem aporte ou resgate lançado, explica que os números mudaram de lugar e sai com "Entendi", para a família inteira.
Fechar grava uma linha já lida em `household_notifications`, tipo `aviso_painel`, fora da lista e do sininho. A tabela já existia, e
o tipo é conferido só pelo formato: não pede migração. Quem só vê não fecha; a nota some quando alguém que grava fechar.

## Fora do escopo por enquanto

Categoria de aporte própria para reserva. Gráfico de evolução com barra de aportes: fica na dica e na tabela. Fatura paga fora do mês da
compra.

## Riscos aceitos

- **Metas e viagens podem ir a zero** em família que aporta quase tudo o que sobra. É verdade: esse dinheiro já saiu. O agente de metas
  passa a dizer que não há espaço, e a família decide.
- **Entre o deploy e a próxima rodada** os relatórios mostram a regra antiga, com o aviso, enquanto o painel já mostra a nova.
- **`isProtectedCategory` olha o nome.** Categoria de aporte renomeada deixa de ser protegida do agente de categorias, que só mexe em
  categoria genérica e nunca toca escolha específica da família.
- **Comparar relatório novo com um da versão 1** mistura as duas contas. Só acontece além da janela de 12 meses, e o aviso aparece.

## Família de prova

`packages/agents/test/aporte-fora-de-despesas.integration.test.ts`, com agentes de verdade rodando duas vezes. Salário de 10.000,
moradia 3.000, mercado 2.000, lazer 1.000, aporte de 3.000 por operação e parcela de meta de 300, de maio a outubro de 2026. Em outubro,
resgate de 1.000 e aporte de US$ 100 a 5,40 (540). Aporte está marcado como essencial de propósito.

| Outubro                  | Antes     | Depois    | Por quê                                          |
| ------------------------ | --------- | --------- | ------------------------------------------------ |
| Receitas                 | 11.000,00 | 10.000,00 | sai o resgate de 1.000                           |
| Despesas                 | 9.840,00  | 6.000,00  | saem aportes de 3.540 e a parcela de meta de 300 |
| Resultado                | 1.160,00  | 4.000,00  | receitas − despesas                              |
| Aportado                 | não havia | 3.840,00  | 3.000 + 540 + 300                                |
| Voltou para as contas    | não havia | 1.000,00  | o resgate                                        |
| Sobrou depois de aportar | não havia | 160,00    | 4.000 − 3.840; os 1.160 de antes menos o resgate |
| Saldo das contas         | igual     | igual     | nenhum lançamento mudou                          |

| Por mês                         | Antes     | Depois    | Por quê                                                                              |
| ------------------------------- | --------- | --------- | ------------------------------------------------------------------------------------ |
| Excedente                       | 4.000,00  | 4.000,00  | já vinha sem aporte                                                                  |
| Gasto médio de 12 meses         | 6.000,00  | 6.000,00  | idem; a renda alvo derivada não muda                                                 |
| Gasto essencial                 | 8.180,00  | 5.000,00  | esta família marcou aporte como essencial; sem essa marca, é 5.000,00 antes e depois |
| Alvo da reserva (6 meses)       | 49.080,00 | 30.000,00 | aporte não é custo de viver; o gasto com moradia e mercado segue inteiro             |
| Disponível (com a folga de 10%) | 3.600,00  | 3.600,00  |                                                                                      |
| Já aportado por mês             | ignorado  | 2.923,33  | média de 3.000 × 5 e 2.540 líquidos em outubro                                       |
| Fatia da aposentadoria          | 1.260,00  | 2.923,33  | o aporte real entra primeiro; quem define a projeção é ele                           |
| Fatia da reserva                | 1.800,00  | 676,67    | só o que sobrou de verdade: 3.600 − 2.923,33                                         |
| Metas                           | 270,00    | 0,00      | o aporte passou da fatia e consumiu metas                                            |
| Viagens                         | 270,00    | 0,00      | idem                                                                                 |
| Sugestão de novo aporte         | 1.260,00  | nenhuma   | a família já faz mais que isso                                                       |

Antes, a divisão repartia 3.600 sem contar os 2.923,33 que já saíam para investimentos. Depois, o aporte real ocupa a fatia dele, e o que
ainda é dividido, 676,67, é o que existe.
