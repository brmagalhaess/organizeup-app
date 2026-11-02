# 13º salário e férias da renda CLT

Pedido do fundador em 2026-11-02: escolher como o 13º é pago, marcar a 1ª parcela já recebida, escolher o mês das férias, dividi-las e
vender dias. O porquê das decisões e as fontes estão no ADR-0028; aqui ficam os campos, os estados e o primeiro uso. Só renda CLT calculada.
PJ, aposentadoria, aluguel e outras rendas não mudam.

## Por que o mês das férias não foi visto

O campo existia, mas:

- Ficava pela metade da largura, entre "Dependentes" e "Pensão", já com "Ainda não sei" marcado, sem título que dissesse "Férias".
- Depois de cadastrada, a renda só voltava ao formulário pelo ícone de lápis, sem texto. O bloco "Férias de 30 dias" do cartão não tinha ação.
- O cartão dizia "Sem mês de férias definido" sem dizer onde definir.
- Era só o mês: dias e venda não existiam em lugar nenhum.

Conserto: o formulário ganha duas seções com título, "13º salário" e "Férias", e o cartão ganha o botão com texto "Ajustar 13º e férias".

## Formulário (Nova renda e Editar renda, tipo Salário CLT)

As seções vêm depois de salário, dia do pagamento e descontos. Tudo é opcional: sem tocar em nada, a previsão fica como antes (ADR-0028).

### Ano das escolhas

"Ano destas escolhas" vem antes das seções, com o ano corrente e o seguinte, e começa no ano corrente. A escolha de um ano vale para ele e para os
seguintes, até haver outra. Quem recebe em julho todo ano escolhe uma vez. Escolher 2027 nunca muda 2026, e mudar um ano que já tem a sua escolha não mexe
em outro que também tenha. Mês que já passou no ano corrente quer dizer "já foi"; para o ano que vem, a pessoa escolhe o ano seguinte.

Ano que herda abre com a escolha herdada e a frase "Mesma escolha de 2026.", no formulário e no cartão. Herda forma, meses, períodos e venda. Marcas de
recebido, valor recebido e baixa são sempre do próprio ano. No ano seguinte não há "Já recebi". Trocar o ano no formulário recomeça as seções com o que vale
naquele ano. Salvar um ano herdado sem mudar nada não cria escolha nova. Sem escolha nenhuma, fica o padrão.

### Seção "13º salário"

| Campo                            | Tipo     | Quando aparece                                      | Padrão           | Regra                                                                                    |
| -------------------------------- | -------- | --------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------- |
| Como você recebe                 | Opções   | Sempre                                              | Em duas parcelas | "Em duas parcelas" ou "Tudo de uma vez"                                                  |
| Mês da 1ª parcela                | Lista    | Em duas parcelas                                    | Novembro         | Fevereiro a novembro, antes da 2ª. Janeiro só com as férias                              |
| Mês da 2ª parcela                | Lista    | Em duas parcelas                                    | Dezembro         | Depois da 1ª                                                                             |
| Mês do pagamento                 | Lista    | Tudo de uma vez                                     | Dezembro         | Um mês                                                                                   |
| Receber a 1ª junto com as férias | Caixa    | Em duas parcelas, com período de férias             | Desligada        | A 1ª cai na data do pagamento das férias. Dica: a lei pede o pedido à empresa em janeiro |
| Já recebi a primeira             | Caixa    | Em duas parcelas                                    | Ver abaixo       | Tira a 1ª da previsão, sem criar lançamento                                              |
| Valor da 1ª parcela              | Dinheiro | Com "Já recebi a primeira"                          | Vazio            | Vazio usa metade do 13º. A 2ª parcela desconta este valor                                |
| Registrar também em Lançamentos  | Caixa    | Com "Já recebi a primeira", sem lançamento já feito | Desligada        | Cria o lançamento da 1ª, como o botão Receber                                            |
| Comecei neste emprego em         | Data     | Sempre                                              | Vazio            | Só vale no ano do início: o 13º fica proporcional                                        |

"Já recebi a primeira" aparece ligada sozinha quando o mês muda para um que já passou neste ano. A pessoa vê a marca e pode desligar: aí a 1ª fica em
aberto, como qualquer previsão atrasada, com Receber em Lançamentos. Com a parcela já lançada, a caixa dá lugar ao texto "A 1ª parcela já está em
Lançamentos". O valor lançado é o que a 2ª desconta, mesmo depois de reajuste.

Em "Tudo de uma vez" com mês que já passou, aparece "Já recebi", com a mesma regra, e "Registrar também em Lançamentos". Se a 1ª já tinha sido recebida,
com ou sem lançamento, o valor sai deste pagamento, e o resultado diz quanto. Quando a 1ª cobre todo o líquido, o resultado e o cartão dizem "A 1ª
parcela já cobre todo o 13º líquido, de {valor}: não há mais nada a receber."

Baixa da 2ª parcela ou do pagamento único quita o 13º do ano. Se a pessoa recebeu de uma vez e troca para "Em duas parcelas", com ou sem lançamento, a marca fica,
nada volta para a previsão, e a tela diz "O 13º deste ano já está quitado: nada volta para a previsão."

### Seção "Férias"

Uma linha por período, com até 3. A primeira linha sempre aparece.

| Campo                 | Tipo   | Quando aparece                       | Padrão        | Regra                                                                  |
| --------------------- | ------ | ------------------------------------ | ------------- | ---------------------------------------------------------------------- |
| Mês das férias        | Lista  | Sempre                               | Ainda não sei | "Ainda não sei" deixa o período de fora                                |
| Começa no dia         | Número | Com mês                              | Vazio         | Vazio: a previsão cai no dia do salário daquele mês, e a tela diz isso |
| Dias                  | Número | Com mês                              | 30            | Pelo menos 5; um dos períodos com pelo menos 14                        |
| Já recebi             | Caixa  | Com mês, com pagamento que já passou | Ligada        | Segue a data: pagamento por vir nunca fica marcado                     |
| Adicionar período     | Botão  | Menos de 3 períodos                  |               |                                                                        |
| Remover período       | Botão  | Mais de um período                   |               |                                                                        |
| Vender dias de férias | Caixa  | Com mês                              | Desligada     | Abono de até 10 dias, pago junto do 1º período                         |
| Quantos dias          | Número | Com "Vender dias de férias"          | 10            | De 1 a 10. Dias de férias mais dias vendidos: até 30                   |

Ao tirar um período que tem baixa, o formulário e o cartão avisam: "As férias de {mês} já têm lançamento. Sem esse período, o lançamento continua em Lançamentos e fica
sem período aqui." A baixa não passa para outro período.

### Mensagens do formulário

- Períodos: "Divida em até 3 períodos.", "Cada período precisa de pelo menos 5 dias.", "Um dos períodos precisa de pelo menos 14 dias.",
  "Os períodos se sobrepõem. Confira o dia de início.", "Este mês não tem esse dia."
- Soma: "Férias e dias vendidos somam mais de 30 dias.", "Dá para vender até 10 dias, um terço das férias.", "Informe quantos dias, de 1 a 10."
- 13º: "A 1ª parcela precisa vir antes da 2ª.", "Informe a data de início em um dia que existe." e a validação de valor de sempre.
- Dado que a tela não manda (mês fora da lista, data de início que não existe, renda que não existe): "Confira os dados e tente de novo."

### Resultado ao vivo: "Quanto e quando entra"

Bloco no fim das seções, recalculado a cada mudança com a mesma função do domínio que gera a previsão. Lista por data, no ano atual:

- 13º: 1ª parcela, 2ª parcela, ou "13º, tudo de uma vez". Parcela recebida diz "Recebida".
- Férias: período, dias, data do pagamento, líquido. Com abono, linha "Dias vendidos". Com início no dia 1 ou 2, a frase "A lei manda pagar as férias
  até 2 dias antes do início, por isso este pagamento cai no mês anterior." Com período sem dia, "Sem o dia de início, prevemos no dia do salário."
- Salário dos meses de férias: "Salário de julho: 10 dias trabalhados".
- Dias que sobram: "Faltam 10 dias das suas férias de 30 dias." É aviso, não erro: faltas reduzem as férias (CLT, art. 130).

## Estados

| Estado         | O que aparece                                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Primeiro uso   | Seções com os padrões. O bloco ao vivo pede o salário bruto até ele ser digitado                                                                                                                 |
| Sem escolha    | Cartão com 13º em novembro e dezembro, férias "Sem mês definido" e o botão "Ajustar 13º e férias"                                                                                                |
| Com escolha    | Cartão mostra meses, valores e períodos escolhidos                                                                                                                                               |
| Carregando     | O botão Salvar diz "Salvando", como em todo formulário. O bloco ao vivo é calculado no navegador, sem espera                                                                                     |
| Erro           | Mensagem ligada ao campo por `Field`, e o formulário guarda o que foi digitado. Mensagem geral em `FormMessage`. Falha ao criar o lançamento mantém a renda salva e volta com o id, sem duplicar |
| Valor inválido | O bloco ao vivo diz "Confira os valores para ver o resultado."                                                                                                                                   |
| Banco atrasado | Sem as tabelas novas, a tela mostra o padrão de hoje. Salvar uma escolha diz "Ainda não deu para guardar esta escolha. Tente de novo em alguns minutos."                                         |
| Só leitura     | Quem não pode gravar vê os valores, sem o botão de ajuste                                                                                                                                        |
| Fora do real   | CLT não aparece. Nada muda                                                                                                                                                                       |

## Caso real: recebi a 1ª em julho

Hoje é 02/11/2026. A pessoa abre o cartão, toca "Ajustar 13º e férias", escolhe julho em "Mês da 1ª parcela". "Já recebi a primeira" liga sozinha, e o
valor fica opcional. Ao salvar:

- Nenhuma previsão de 1ª parcela em novembro nem em julho, sem atraso.
- 2ª parcela em 20/12, com o desconto do valor informado ou de metade do 13º, com INSS e IR do 13º inteiro.
- Nenhum lançamento é criado, a não ser com "Registrar também em Lançamentos".

## Telas que mudam junto

Tudo o que usa `scheduledIncome`/`loadCommitments` recebe a mesma previsão: Painel, Lançamentos, Calendário, importação de extrato, Plano e assistente. O
relatório mensal usa `incomeBetween` com as mesmas escolhas, e o mês fechado segue a regra do `source_hash`. Aposentadoria e divisão do excedente usam o
líquido de um mês normal (`monthlyNet`) e a média do que foi lançado, sem 13º nem férias, como antes. `ver_renda` passa a contar parcelas e períodos.

## Fora do escopo

Salário variável, horas extras e médias nas férias, faltas reduzindo os dias (art. 130), férias coletivas, férias em dobro, rescisão, 13º de aposentados,
início de férias perto de feriado (art. 134, § 3º, fica como informação na dica).
