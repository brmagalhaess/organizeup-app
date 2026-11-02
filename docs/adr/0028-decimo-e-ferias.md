# ADR-0028 — 13º e férias da renda CLT

Status: aceito (2026-11-02). Pedido do fundador: "já recebi em julho a primeira parcela, mas o sistema está falando que vou receber a primeira agora em
novembro" e "as férias não estão me dando a opção de escolher o mês das férias e se vou tirar integral ou vender parte delas".

Soma ao ADR-0009, que tratava 13º e férias só pelo padrão e deixava fora do escopo proporcional, férias divididas, vendidas e 13º nas férias. Campos, estados e
primeiro uso: `docs/specs/decimo-e-ferias.md`.

## Fontes conferidas em 2026-11-02

| Regra                                                                                                                 | Fonte                                                                       | Situação                                  |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------- |
| 13º: 1/12 da remuneração de dezembro por mês de serviço. Fração de 15 dias ou mais conta como mês                     | Lei 4.090/1962, art. 1º, §§ 1º e 2º (Planalto)                              | Confirmado                                |
| Pagar até 20/12, compensando o adiantamento                                                                           | Lei 4.749/1965, art. 1º (Planalto); Decreto 10.854/2021, art. 76 (Planalto) | Confirmado                                |
| Adiantamento de fevereiro a novembro, uma vez só, metade do salário do mês anterior. Não precisa ser igual para todos | Lei 4.749/1965, art. 2º e § 1º; Decreto 10.854/2021, art. 78                | Confirmado                                |
| Adiantamento com as férias, pedido em janeiro                                                                         | Lei 4.749/1965, art. 2º, § 2º; Decreto 10.854/2021, art. 79                 | Confirmado                                |
| Admitido no ano: adiantamento é metade de 1/12 por mês de serviço                                                     | Decreto 10.854/2021, art. 78, § 4º (Planalto)                               | Confirmado                                |
| IR do 13º: valor inteiro, exclusivo, no mês da quitação, sem retenção em adiantamento                                 | Lei 8.134/1990, art. 16 (Planalto)                                          | Confirmado                                |
| Até 3 períodos, um com 14 dias corridos ou mais, os demais com 5 ou mais                                              | CLT, art. 134, § 1º (Planalto)                                              | Confirmado                                |
| Proibido começar nos 2 dias antes de feriado ou repouso semanal                                                       | CLT, art. 134, § 3º (Planalto)                                              | Confirmado. Não validado: sem calendário  |
| Converter 1/3 das férias em abono                                                                                     | CLT, art. 143 (Planalto). "Até 1/3": Parecer PGFN/CRJ 2140/2006             | Confirmado                                |
| Férias e abono pagos até 2 dias antes do início                                                                       | CLT, art. 145 (Planalto)                                                    | Confirmado                                |
| Férias + 1/3: IR no mês do pagamento, em separado de outro rendimento, com pensão, dependentes e previdência          | Perguntas e Respostas IRPF 2026, pergunta 178 (Receita)                     | Confirmado                                |
| Abono do art. 143 fora do IR                                                                                          | Pergunta 178 e Ato Declaratório PGFN 6/2006                                 | Confirmado                                |
| Terço sobre o abono, pago no curso do contrato, é tributado pelo IR                                                   | Solução de Consulta Cosit 209/2021                                          | Confirmado na ementa, por transcrição (1) |
| IR sobre o terço de férias gozadas                                                                                    | STJ, Tema 881, citado pela PGFN (gov.br)                                    | Confirmado                                |
| Abono de férias fora do salário de contribuição                                                                       | Lei 8.212/1991, art. 28, § 9º, "e", item 6 (Planalto)                       | Confirmado                                |
| INSS das férias no mês a que se referem, mesmo pagas antes                                                            | Decreto 3.048/1999, art. 214, § 14                                          | Confirmado por transcrição (2)            |
| INSS sobre o terço do abono                                                                                           | Nenhuma fonte oficial achada; doutrina dividida                             | **Não confirmado. Fora do cálculo**       |
| Redução da Lei 15.270/2025 nas férias                                                                                 | Orientação de dezembro de 2025 e Perguntas e Respostas 2026 não falam disso | **Não confirmado** (ADR-0009)             |

(1) O portal de normas da Receita não abriu. A ementa foi lida na transcrição do DOU de 29/12/2021, com o mesmo teor em duas outras fontes. (2) A página do Planalto corta antes do
art. 214; o texto foi lido em transcrição da norma.

## Decisão

### Onde fica

- **Tabela nova `income_year_plans`, não colunas em `income_sources`.** Toda leitura de renda faz `select()` da tabela: uma coluna nova derrubaria as telas enquanto a web sobe antes do
  worker. A leitura da tabela nova fica em savepoint, e sem ela vale o padrão.
- **Uma linha por renda e ano, que vale daquele ano em diante, até a próxima.** O ano olha só a linha mais recente, anterior ou igual a ele: escolher 2027 nunca muda 2026, escolher 2028 deixa 2026 e 2027 como
  estão, e mudar 2026 depois de existir 2027 muda só 2026. Quem recebe em julho todo ano escolhe uma vez. Herdar copia forma, meses, períodos e venda; marcas de recebido, valor recebido e baixa são sempre do
  próprio ano. O ano que herda diz "Mesma escolha de 2026". O formulário tem seletor com o ano corrente e o seguinte.
- **`vacation_month` é o padrão dos anos sem escolha, e só nasce com a renda.** Escolher um ano não o toca: por isso 2027 não mexe em 2026 nem nos anos anteriores, sem precisar gravar
  linha para congelar o passado. Mudar o mês de uma renda que já existe cria a linha do ano.
- **`income_receipts` não muda.** A CHECK das partes só aceita quatro valores, e trocá-la exige `DROP CONSTRAINT`. O 2º e o 3º período vão para `income_vacation_receipts`, com partes
  `ferias-2` e `ferias-3`. O 1º continua `ferias`. A integral usa a parte `13-2`: é a quitação, e não precisa de chave nova.
- **Dado informado (regra 7).** Só a tela grava. Nenhum agente escreve nessas tabelas, com teste.
- **Nada novo em `canUse`.** Renda segue fora dos módulos.

### Quem não escolhe nada

`monthIncome` passou a ter um caminho só, com o plano padrão. A cópia da função antiga está em `decimo-e-ferias.test.ts`, e o fast-check compara mês a mês, sem plano e com o plano padrão salvo.

Duas exceções, e só elas, ambas para quem tem baixa no banco. A 2ª parcela desconta o valor lançado da 1ª, não metade do salário de hoje. E quem nunca escolheu e mudou `vacation_month` antes
desta versão, depois de receber as férias naquele ano, não vê as férias de novo: a conta antiga previa pagar duas vezes. O fuzz de igualdade não gera esse caso, porque a baixa dele vem das próprias
previsões, e um teste fixa a exceção.

### 13º

- **Duas parcelas:** 1ª de fevereiro a novembro (Lei 4.749/1965, art. 2º), 2ª em dezembro, editável. Novembro cai em 30/11 e dezembro em 20/12, como antes; outro mês, no dia do salário. Janeiro só
  existe pela opção "com as férias".
- **2ª parcela = 13º líquido − adiantado.** O adiantado é, nesta ordem, o valor do lançamento, o valor informado ou metade do 13º. O lançamento manda porque é o dinheiro que entrou: 1ª de 3.000 com salário
  que subiu para 6.600 dá 2ª de 2.267,60. INSS e IR do valor inteiro saem da 2ª. Se o adiantado cobrir o líquido, a previsão some, e a tela explica.
- **Tudo de uma vez:** um pagamento no mês escolhido, com INSS e IR do valor inteiro. A lei fala em adiantamento até novembro e saldo até 20/12, mas não proíbe quitar de uma vez dentro do prazo,
  e o IR é no mês da quitação. Em mês que já passou, oferece "Já recebi" (`thirteenth_single_received`) e "Registrar também". Trocar para cá depois de receber a 1ª, com ou sem lançamento,
  desconta o recebido: a marca não se perde.
- **Com as férias:** a 1ª cai na data do pagamento do primeiro período. Se ele for pago no ano anterior ou depois da 2ª parcela, fica o mês escolhido. A tela lembra que o pedido é em janeiro.
- **Proporcional usa data nova, `job_started_on`.** `start_month` não serve: é quando a previsão começa, e `firstIncomeMonth` joga para o mês seguinte. Usá-lo daria 13º de 2/12 a quem cadastrou
  em novembro um emprego de anos.
- **"Já recebi" sem lançamento:** `thirteenth_first_received` tira a 1ª da previsão. Previsão não é lançamento, então nada entra no saldo. Ao mudar para um mês que já passou, a marca liga sozinha,
  à vista, e a pessoa pode desligar. Salvar sem mudar o mês não liga nada.
- **Com "Registrar também":** cria lançamento e `income_receipts` pelo mesmo caminho do botão Receber, e a marca fica desligada. Assim apagar o lançamento devolve a previsão (ADR-0009). A data é a da
  previsão, ou hoje se ela ainda não chegou. A 1ª anterior a `start_month` pode ser registrada: só a previsão começa depois.

### Férias

- **Cada período tem mês, dia de início opcional e dias.** Sem o dia, fica como hoje: previsão no dia do salário daquele mês, com os dias todos nele. Com o dia, pagamento 2 dias antes do início.
  Início em 1º ou 2 cai no mês anterior, e a tela explica.
- **A chave usa o mês do início**, não o do pagamento. Assim um `ferias` já recebido em `2026-07` continua casando depois de a pessoa informar o dia 1º. Período movido depois de recebido guarda o mês da
  baixa em `keyMonth`, no jsonb. `findIncomeEntry` acha a previsão pela chave.
- **Dia 1 ou 2 do primeiro mês da renda:** o pagamento cai antes de `start_month`, e a previsão entra mesmo assim, só com essas férias.
- **30 dias de folha.** Salário, terço, pensão e outros descontos são repartidos com arredondamento do acumulado: 20 dias mais 10 vendidos somam um salário, centavo a centavo. Em cada mês, dias de
  férias e dias trabalhados somam 30, inclusive em fevereiro e em férias que atravessam meses. Propriedade: em 12 meses, salário de férias mais trabalhados dá 12 salários.
- **O mês do salário é o da previsão.** A renda só sabe o dia do pagamento, não a que mês ele se refere. Com pagamento no início do mês, a folha real pode descontar os dias só no mês seguinte. O total do
  ano é o mesmo; é o mesmo limite do ADR-0009, que trocava o salário pelas férias no próprio mês.
- **INSS por mês:** as férias entram no mês a que se referem, somadas ao salário daquele mês para faixas e teto.
- **IR separado:** férias + 1/3 + terço do abono, com INSS, dependentes e a parte da pensão nos dias. O abono fica fora. O salário dos dias trabalhados tem IR próprio, com a redução.
- **Abono:** dias vendidos são trabalhados, então não tiram salário. Quantidade única no ano, paga com o primeiro período. Limite de 10 dias e de 30 no total.
- **Até 3 períodos por ano.**
- **Dias que sobram são aviso, não erro:** faltas reduzem as férias (CLT, art. 130), e o sistema não sabe delas.
- **Período passado:** mesma marca "Já recebi", por período. A marca é da data: liga quando o mês ou o dia mudam para uma data que já passou, e pagamento por vir nunca fica marcado, na tela e no servidor.
  Mover férias recebidas de julho para dezembro mantém a previsão de dezembro.

### Redução nas férias

Não há fonte nova. A previsão segue pelo valor sem a redução, o menor, e a tela diz até quanto pode vir.

### Baixas e mudança de escolha

- A chave exata vale para todos.
- **13º é um por ano:** baixa de `13-1` ou `13-2` em qualquer mês do ano fecha aquela parte, com ou sem escolha salva. `confirmByKey` recusa pela mesma regra, então não se recebe duas vezes.
- **Férias casam pelo mês da chave, nunca pela posição:** período novo antes do recebido não troca qual foi pago, e previsão nunca some sem baixa real.
- **Ao salvar, a baixa acompanha o período movido** (`carryVacationKeys`). Mês igual casa primeiro. O que sobrou dos dois lados é período movido. Período que só saiu não passa a baixa a ninguém: com
  outubro recebido e novembro aberto, tirar outubro deixa novembro em aberto; mudar outubro para dezembro deixa dezembro recebido.
- Sem linha do próprio ano e com um período só, a baixa de férias de outro mês é dele mesmo (ver "Quem não escolhe nada"). Com vários períodos herdados, baixa sem período não fecha nenhum.

### Telas

- `scheduledIncome`, `incomeOccurrence`, `loadIncome`, relatório e `ver_renda` leem por `withIncomePlans`, e `incomeYearView` monta a tela com as mesmas funções da previsão. O formulário roda a mesma conta no
  navegador.
- Relatório fechado segue o `source_hash`, que olha o que foi lançado: mudar a escolha não reabre mês fechado. Um teste confere.
- Aposentadoria, reserva e divisão do excedente usam `monthlyNet` e a média do que foi lançado, sem 13º nem férias, e não mudam. Quem usa o abono ou o proporcional vê isso nas previsões do mês, não na média.

## Fora do escopo

Faltas reduzindo as férias, salário variável e médias, férias coletivas e em dobro, rescisão, feriados no início das férias, FGTS e o IR de 13º de quem tem mais de uma fonte pagadora.

## Migração e implantação

`0040`, sozinha no primeiro commit, sem grants próprios: as tabelas cabem no GRANT geral do migrador. Só aditiva, sem `DROP`. A web tolera a tabela ausente: lê o padrão, e salvar uma escolha pede para tentar depois,
sem gravar a renda pela metade.
