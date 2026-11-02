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
- **Categoria renomeada segue guardada para sempre, seja qual for o nome novo.** A categoria 90 ou 91 renomeada para outra coisa, como "Seguro de
  vida", continua sendo meta ou aporte. É o preço de não depender do nome, e a etiqueta "Fora de despesas" aparece na lista de Categorias,
  então a família vê.
- **Meta é dinheiro guardado, com o mesmo tratamento.** A parcela não some: vira saldo de meta ou entra numa conta da família.
  Excedente e gasto médio já a tiravam (ADR-0015). Reserva não tem categoria própria: é transferência, que nunca foi receita nem
  despesa, ou aporte lançado na categoria de aportes.
- **Resgate é o simétrico do aporte.** O dinheiro já era da família, então não é receita. Entra em "Voltou para as contas". A perna
  de entrada de uma parcela de meta com conta de destino cai no mesmo número: é dinheiro que chega numa conta sem ser renda. Por isso o
  rótulo diz "voltou para as contas", e não "resgate". Na lista de Lançamentos, essa entrada leva a etiqueta "Resgate".
- **Venda com lucro é resgate inteira.** O sistema não separa ganho de capital no lançamento: o valor todo vai para "Voltou para as
  contas", e nada vira receita. É um limite, e o ganho continua visível na tela de Investimentos.
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
fundador. Resgate fica fora dela e aparece ao lado: quem vende e recompra no mesmo mês vê Aportado e "Voltou para as contas" juntos, e a
dica do número diz que resgate não entra nesta conta.

### Compra de cartão na categoria de aportes

Chega ao mês dentro da fatura. `splitCardSavings` separa a parte dela, só para somar: a lista continua mostrando a fatura inteira. A
soma não muda. Se a fatura foi paga em outro mês, a compra fica fora de aportes no mês dela, e o pagamento segue despesa. É o mesmo
limite que `spendingByCategory` sempre teve. O hábito lê as mesmas entradas divididas do excedente (`splitMonthEntries`), então excedente,
hábito e o "Aportado" do painel fecham: 3.000 de aporte no cartão aparecem nos três.

### Extrato importado

Aplicação vira aporte pela palavra do extrato, e o resgate da mesma aplicação agora também: `KEYWORDS.receita` manda "resgate", "resg" e
"res aplic" para a categoria de aportes, como receita, só com um termo de aplicação na descrição (CDB, LCI, LCA, aplicação, aplic, fundo,
poupança, tesouro, RDB, previdência). FGTS, pontos, seguro, consórcio, prêmio e capitalização ficam de fora mesmo com esse termo, e "resgate"
sozinho não diz de onde veio: vai para revisar. Aplicação e resgate automáticos no mesmo valor dão hábito líquido zero, porque o
hábito mede aportes menos resgates. No histórico, a revisão diária move só o que veio de importação e ficou em categoria genérica, de
qualquer data, com notificação e Desfazer, pela exceção de categoria da regra 7. O que a família pôs em categoria específica, ou lançou
à mão, não muda. O desfeito não volta. A regra mais larga, que moveria FGTS e pontos, só existiu neste branch e nunca rodou em produção, então
não há nada a reverter.

### Operação sem conta

Não saiu dinheiro de conta, então não entra em "Aportado". A seção Investimentos do painel continua somando pelas operações, e a tela
diz a diferença.

### Excedente, reserva e divisão

- **O excedente não sobe.** `surplusInputs` já tirava aporte e meta da conta, por nome. O excedente continua sendo receitas menos
  despesas, antes dos aportes. Só muda em operação cuja categoria tinha sido renomeada, em que a conta antiga errava para menos.
- **O risco real era outro: a divisão ignorava o que já é aportado.** Uma família com 4.000 de excedente que já investe 3.000 tinha os
  3.600 disponíveis divididos como se nada tivesse saído. Agora `savingHabit` mede o hábito de investir (aportes menos resgates) e o de
  metas (parcelas pagas; a entrada na conta de destino não abate), e `suggestAllocation` recebe os dois.
- **O hábito é dinheiro que de fato sai, e não passa à frente de ninguém.** A prioridade continua reserva, dívidas caras, aposentadoria,
  metas e viagens. A divisão reparte só o que resta depois do hábito, nessa ordem, e nunca promete mais do que sobra. As fatias que a ordem
  pediria são medidas sobre o disponível inteiro: assim quem segue a sugestão recebe a mesma sugestão no mês seguinte, sem oscilar. O que
  já é feito conta na fatia dele, e a soma das fatias é sempre o disponível.
- **Reserva ou dívida curtas por causa do hábito** ficam em `reserveShort` e `debtShort`. As notas dizem quanto pedem, quanto cabe e por
  quê; a tela de Aposentadoria diz em uma frase; o plano do mês não pede para guardar mais; e nasce um lembrete de redirecionar parte
  do aporte, que só leva à tela. Nada muda sozinho.
- **Sugestão só sobe.** `aporte_investimento` só nasce se a divisão pedir mais do que a família já faz e do que ela aceitou, e
  `aporte_reserva`, mais do que ela aceitou. Valor aceito nunca vira sugestão de redução, nem na tela de Aposentadoria: quando ele passa
  do que sobra, um lembrete só informa.
- **Sugestão que a divisão não pede mais fecha sozinha,** com `closePending`, em aporte de reserva, de investimento e de dívida, e
  nos dois lembretes. Sem contar como recusa, e sem tocar no que nasceu na conversa com o assistente: `upsertPending` também não a sobrescreve, mesmo com a mesma chave. O `aporte_divida` do agente de dívidas
  fica enquanto a divisão ainda tiver dinheiro para dívidas.
- **Aporte para a reserva conta como investimento.** A categoria de aportes não diz para onde o dinheiro foi, então todo aporte nela
  entra no hábito de investir. Quem manda 3.000 por mês para a reserva nessa categoria vê a fatia da aposentadoria subir e a da reserva
  cair. A regra fica, e a tela de Aposentadoria diz isso em uma frase, com o caminho que já existe: marcar a conta em Reserva e transferir
  para ela. Transferência não é aporte, e a conta marcada soma no guardado da reserva.
- **Projeção.** Sem aporte informado, a projeção usa `allocation.retirement`, que nunca fica abaixo do aporte real, e a tela de
  Aposentadoria diz isso em uma frase. Com aporte informado, vale o informado.
- **Meta com parcela paga não perde plano.** O hábito de meta ocupa o orçamento de metas, então a parcela real não é contada duas vezes
  nem sai do plano. Se ainda assim não couber, por exemplo sem excedente, a meta que tinha plano fica como estava, com as parcelas abertas e
  um aviso: falta de sobra não apaga plano. Só as parcelas por vir ficam, e a que passou sai. Sem nenhuma por vir, não há o que manter: a meta
  volta ao caminho normal, com a nota de sem orçamento e a sugestão de ajustar a data. `desired_month` só muda por sugestão aceita.
- **O que `min(média, mediana)` faz com o hábito**, em 12 meses de movimento, é o que o excedente já faz. Quem começou há pouco ou aporta
  por trimestre fica com zero até virar costume. Nesses casos a divisão reparte como se o aporte não existisse, e o hábito volta a contar
  quando chegar à maioria dos meses. Com menos de 3 meses, zero. Sem histórico, vale a soma das previsões recorrentes.

| Caso                         | Hábito   |
| ---------------------------- | -------- |
| 3.000 fixos                  | 3.000,00 |
| 3.000 e um resgate de 20.000 | 1.333,33 |
| 3.000 e um resgate de 40.000 | 0,00     |
| Um aporte único de 50.000    | 0,00     |
| Começou há três meses        | 0,00     |
| 6.000 em meses alternados    | 3.000,00 |
| 9.000 por trimestre          | 0,00     |

- **Reserva.** O alvo vem de categorias essenciais. Aporte nunca entra, mesmo em categoria marcada como essencial, e a média só usa
  mês com gasto essencial, então mês só com aporte não dilui nada. O alvo não depende do hábito. A fatia mensal é limitada pelo que resta.
- **Plano do mês:** `largestCategory` ignora aporte. Antes, um aporte grande virava "corte 10% do seu maior gasto".

### Relatórios já fechados

- **`STATEMENT_RULE_VERSION` vale 2** e entra na assinatura de resumo, categorias, fluxo e anual. Na primeira rodada, o que está fechado
  nos últimos 12 meses e o anual anterior regeneram pelo caminho de sempre, com `revised_at` e o aviso `aporteSeparado`, que muda o texto
  de "atualizado em". Na rodada seguinte a assinatura bate e nada acontece. Patrimônio, investimentos, proventos, dívidas, metas e
  aposentadoria não mudam com a regra e ficam intactos.
- **O parágrafo "O que mudou" sai,** como em toda regeneração: falava de outros números. `narrated_at` continua marcado, então a
  regeneração não chama o modelo. Um relatório fechado que ainda não tinha parágrafo ganha o único a que já tinha direito.
- **A posição do fim do ano do anual é preservada,** em toda regeneração. Ela é uma foto que só existe em janeiro.
- **A projeção do fluxo fechado fica como era,** com a nota de que ainda conta aportes como despesas. Só existe no fechamento, e refazê-la
  depois daria outra conta. Perder em silêncio seria pior.
- **Mês só com resgate** continua tendo fluxo.
- **Mais antigo que a janela, ou antes da primeira rodada:** continua como está, com `data.version` 1, e a tela diz que ainda conta
  aportes como despesas. Mês fora dos 12 meses não regenera: a assinatura sairia vazia.
- **O fluxo entra na assinatura.** A exceção ao "o que um agente faz não reabre" do ADR-0021: um lançamento que vira aporte ou resgate, ou que
  volta por Desfazer, muda os números, e o mês regenera. Troca entre categorias comuns feita por agente continua sem reabrir.
- **Só com aporte:** mês assim continua tendo relatório. Sem isso, a regeneração o apagaria.

### Assistente e dicas

`resumo_do_mes` e `listar_lancamentos` trazem os números à parte, e as instruções dizem para não somar. As somas de `listar_lancamentos`
separam o que já saiu (`soma_despesas`, igual ao `gasto` do resumo), o que foi comprado com a fatura em aberto (`soma_comprada_fatura_aberta`) e
o que ainda vai sair (`soma_prevista_despesas`, igual a `despesa_prevista`). Pergunta sobre gasto usa `soma_despesas_com_comprado` ou
`gasto_com_comprado`, que vêm prontas: o modelo não faz a conta. O pagamento de fatura é abatido pelas compras de faturas pagas do mês, antes de
qualquer filtro, e vem em `soma_pagamentos_de_fatura`. As dicas da madrugada leem pelas
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

- **Reserva e dívida cara podem ficar curtas por causa do hábito.** O produto continua dizendo que elas vêm primeiro, mas o aporte da
  família já saiu, e prometer esse dinheiro de novo seria mentira. O sistema diz isso, sugere redirecionar e não muda nada sozinho. Enquanto
  a família não decidir, a reserva cresce mais devagar do que a ordem pede.
- **Viagens novas podem ir a zero,** e metas ficam só com a parcela real, em família que aporta quase tudo o que sobra. É verdade: esse
  dinheiro já saiu. Meta sem nada real não ganha plano novo até sobrar.
- **Hábito que acabou de mudar** demora a aparecer: `min(média, mediana)` protege contra pico, e cobra isso de quem acabou de começar a
  aportar, que vê uma divisão otimista por alguns meses.
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

| Por mês                         | Antes        | Depois    | Por quê                                                                              |
| ------------------------------- | ------------ | --------- | ------------------------------------------------------------------------------------ |
| Excedente                       | 4.000,00     | 4.000,00  | já vinha sem aporte                                                                  |
| Gasto médio de 12 meses         | 6.000,00     | 6.000,00  | idem; a renda alvo derivada não muda                                                 |
| Gasto essencial                 | 8.180,00     | 5.000,00  | esta família marcou aporte como essencial; sem essa marca, é 5.000,00 antes e depois |
| Alvo da reserva (6 meses)       | 49.080,00    | 30.000,00 | aporte não é custo de viver; o gasto com moradia e mercado segue inteiro             |
| Disponível (com a folga de 10%) | 3.600,00     | 3.600,00  |                                                                                      |
| Já aportado por mês             | ignorado     | 2.923,33  | média de 3.000 × 5 e 2.540 líquidos em outubro                                       |
| Já pago em metas por mês        | ignorado     | 300,00    | a parcela real da reforma                                                            |
| Fatia da aposentadoria          | 1.260,00     | 2.923,33  | o aporte real conta na fatia dele; é ele que entra na projeção                       |
| Fatia da reserva                | 1.800,00     | 376,67    | a reserva vem primeiro no que resta: 3.600 − 2.923,33 − 300                          |
| Reserva curta                   | não se dizia | 1.423,33  | a ordem pede 1.800; nota e lembrete dizem, e redirecionar é da família               |
| Metas                           | 270,00       | 300,00    | a parcela real fica, e o plano também                                                |
| Viagens                         | 270,00       | 0,00      | não resta nada para elas                                                             |
| Sugestão de novo aporte         | 1.260,00     | nenhuma   | a família já faz mais que isso                                                       |

Antes, a divisão repartia 3.600 sem contar os 3.223,33 que já saíam. Depois, o que já sai ocupa as fatias dele, e o que ainda é dividido,
376,67, é o que existe, e vai para a reserva.
