# ADR-0017 — Cotações e proventos automáticos

Status: aceito (2026-10-31)

Substitui a parte do ADR-0012 sobre cotação manual ("Preços vêm da família") e a frase "sem cotação
externa" do ADR-0015 para o que está aqui. O AGENTS.md, regra 9, ainda diz "sem cotação externa"; continua
valendo para os agentes diários, que não chamam nada de fora, e a coleta é um job à parte.

## Decisão

### Coleta

- **Job `market-data` no worker**, fila própria, às 18:30 de segunda a sexta (depois do fechamento) e às 03:30
  de terça a sábado (antes dos agentes das 04:00), `America/Sao_Paulo`, e no boot se ainda não rodou hoje.
  `DAILY_AGENTS_ENABLED=false` desliga junto.
- **Fontes:** brapi.dev para cotações e proventos da B3; SGS do Banco Central, sem chave, para CDI (série
  12), SELIC (11) e IPCA (433). Índices ficam guardados; nada os usa ainda.
- **Rota antiga da brapi** (`/api/quote/{ticker}?dividends=true`): traz cotação e proventos numa chamada só. A
  documentação recomenda a v2 para integrações novas, mas ela pede uma chamada por tipo de dado e dobraria o
  gasto. A rota antiga "continua ativa e não tem data de remoção". FII tem rota própria,
  `/api/v2/fii/dividends`, e custa uma chamada a mais.
- **Tudo fora de `withHousehold`** (regra do `tenant.ts`). O job percorre as famílias ativas só para somar
  tickers distintos, sem guardar quem tem o quê, e consulta cada um uma vez. Só sai do sistema código que
  passa no formato da B3 (`normalizeTicker`): o campo é livre e aceitaria um nome. Por isso a Política de
  Privacidade não muda.
- **Tabelas globais** `market_quotes`, `market_dividends`, `market_indices`, `market_tickers` e `market_usage`,
  sem RLS de tenant, como `trip_destination_templates`. Leitura para web e worker; escrita só para `ou_worker`
  (grants no migrador); ninguém apaga.
- **Orçamento.** `BRAPI_MAX_CALLS_PER_DAY`, padrão 400, vale para o dia inteiro e é contado em `market_usage`,
  porque são duas rodadas e o worker reinicia: um teto por rodada estouraria as 15.000 do mês, e passar do
  limite encerra a licença (termos de uso, seção de restrições). 429 ou token recusado param a rodada na hora.
  Ticker consultado há menos de 12 horas fica de fora, então a rodada da madrugada só cobre o que faltou.
  Quem foi consultado há mais tempo vem primeiro. A chave vai no cabeçalho, como pede a documentação.
- **Ticker que a fonte não reconhece** fica em `market_tickers` e só volta a ser consultado depois de 30 dias.
  Falha de rede ou da fonte tenta na rodada seguinte. Falha de um ticker não para os outros.
- **Contagens em `ops.agent_runs`**, com agent `mercado`: `households`, `ok` (tickers), `failed`, e `applied`
  (linhas de provento e índice gravadas). Logs só com contagem e código de erro.

### O que a fonte entrega e o que aproveitamos

- **Só entra o que a fonte confirma:** `verified: true`, com data-com, data de pagamento e rótulo `DIVIDENDO`,
  `JCP` ou `RENDIMENTO`. Sem data de pagamento não dá para gravar (`dividends.paid_on` é obrigatório).
  Em FII, `remarks` preenchido quer dizer que as datas são as do informe mensal, então fica de fora, e
  amortização também, porque devolve capital. Histórico coletado: 5 anos.
- **`com_date` além de `ex_date`.** A data-com decide o direito, e a fonte às vezes não traz data ex: em FII,
  nunca. Por isso o direito se apoia em `com_date`.
- **Valor pago, não ajustado.** A brapi ajusta o `rate` por desdobramento, grupamento e bonificação posteriores.
  Prova real: ITUB4, data-com 28/11/2025, `rate` 0,01713592233, que × 1,03 da bonificação de 23/12/2025 dá
  R$ 0,01765, ou R$ 0,015 líquido a 15%. `rawRate` existe só no plano Pro em ações; desfazemos o ajuste com os
  fatores que vêm na mesma resposta (`paidRate`). Em FII, `rawRate` vem de graça.
- **Chave natural com `seq`:** `(ticker, kind, com_date, pay_date, seq)`. A fonte tem pagamentos com mesmas
  datas e valores diferentes, de verdade (ITUB4, 15/02/2018). Com o valor fora da chave, uma correção na fonte
  atualiza a linha em vez de duplicar. Mudança da data de pagamento na fonte gera linha nova: veja os riscos.

### Direito e imposto (regras em `packages/domain/src/market.ts`)

- **Quantidade:** `positionOf` só com operações até a data-com, inclusive. Compra na data-com conta, venda na
  data-com tira. Definição da própria brapi: data-com é "o último dia para comprar a ação e ter direito ao
  provento", data ex é "o primeiro dia sem esse direito". Não achamos página oficial da B3 ou da CVM com a
  regra; guias do mercado dizem o mesmo.
- **JCP retém 17,5%, não 15%, desde 01/01/2026.** Lei Complementar 224/2025, art. 8º (nova redação do art. 9º,
  § 2º, da Lei 9.249/1995) e art. 14, III. O imposto incide "na data do pagamento ou do crédito ao
  beneficiário". Conferido nos dados: JCP mensal do ITUB4 de 2026 tem bruto 0,018182, que só dá os R$ 0,015
  líquidos a 17,5%.
- **Virada de ano: data-com em 2025 e pagamento em 2026 não é lançado.** Quem decide é a data do crédito, que
  não vem na fonte, e os dados mostram os dois casos: ITUB4 de 28/11/2025 pago em 02/01/2026 saiu a 15%, e o de
  30/12/2025 pago em 02/02/2026 saiu a 17,5%. Na dúvida, a família confere no extrato e lança; o sistema
  avisa com uma sugestão por mês. Isso some sozinho conforme esses pagamentos ficam para trás.
- **Dividendo não retém**, salvo acima de R$ 50 mil no mês da mesma empresa para a mesma pessoa, que retém 10%
  do total (Lei 15.270/2025, art. 6º-A da Lei 9.250/1995). Como depende do titular, que o sistema não sabe, esse
  caso fica para a família conferir, em vez de gravar imposto zero.
- **Rendimento de FII não retém**, nas condições da Lei 11.033/2004, art. 3º (100 cotistas ou mais; quem tem 10%
  ou mais fica de fora). "Rendimento" em ação ou ETF não é lançado: em ação é correção de outro provento, e em
  ETF o imposto depende do fundo.
- **BDR** recebe como dividendo, com `withheld` zero: o Brasil não retém (o imposto é carnê-leão), e o valor
  pode já vir líquido de imposto no exterior. Não verificado com dados reais, porque exige token.
- O bruto e o retido são calculados e arredondados em centavos; o extrato pode divergir em um centavo.

### O que muda na carteira da família (agente `investimentos`)

- **Preço.** Cotação entra em `current_price`, `valued_on` e `price_source = 'mercado'` para `acao`, `fii` e
  `etf_bdr` com ticker. Preço que a família digitou na data da cotação ou depois fica (`quoteApplies`), até
  chegar cotação mais nova: a comparação é por data, porque `investments` não guarda hora. Por pedido do
  fundador, o preço de ativo com ticker passa a ser dado derivado, e a tela avisa que o valor digitado vale
  até a próxima cotação.
- **Provento.** Linha em `dividends` com `source = 'agente'` e `market_dividend_id`, com índice único parcial.
  Se a operação ou o valor na fonte muda, a linha é corrigida; se a posição some ou o ticker muda, sai.
  **Provento que a família já lançou à mão não duplica**: lançamento no mesmo investimento até 5 dias do
  pagamento conta como o mesmo. Quem tinha lançado o total de JCP e dividendo numa linha só cobre os dois.
- **"A receber" não tem coluna:** é `paid_on` depois de hoje. `receivedDividends` tira essas linhas de todas as
  somas, inclusive do mês corrente. Isso vale também para quem digitou data futura à mão.
- **Uma sugestão `aplicada`/`agente` por dia**, chave `mercado:dia:<data>`, com resumo e a lista do que mudou no
  payload. Rodar de novo no mesmo dia junta na mesma linha. Regra 7 mantida.
- **Desfazer** devolve preço e proventos, se ainda estiverem como o sistema deixou, e marca `desfeita`. O que
  fica bloqueado para sempre é aquela alteração: cada provento por investimento, e cada preço por investimento e
  data de cotação. A cotação do dia seguinte entra normalmente; bloquear o ativo inteiro faria um clique
  desligar a automação da carteira toda, já que a sugestão é uma só por dia.
- **Excluir provento automático** grava uma linha `desfeita` em `household_suggestions`, que o agente lê para não
  recriar.
- **Evento em ações** (desdobramento, grupamento, bonificação) gera aviso, uma vez por evento, para quem tinha
  posição antes dele. O ADR-0012 segue sem ajuste automático de quantidade.
- **Aposentadoria.** `dividendPlanInputs` já lia `dividends`, então o rendimento observado passa a refletir o
  provento real, sem linha nova no plano. "A receber" fica fora, e a dedupe acima evita contar duas vezes.
  Relatório e tela usam o mesmo corte. A previsão por histórico (`forecastDividends`) não soma com "a receber":
  são cartões separados.
- **Sem recomendação de compra ou venda** (CVM). Telas sem "agente", "yield" ou "aporte".

### Variáveis (serviço `ou3-worker`)

`BRAPI_TOKEN` e `BRAPI_MAX_CALLS_PER_DAY`. Sem token, consulta só PETR4, VALE3, MGLU3 e ITUB4, loga um aviso e
segue. Detalhes no runbook de bootstrap.

## O que a API devolveu de verdade em 2026-10-31

- Sem token: os quatro tickers livres respondem com todo o histórico de proventos (ITUB4 desde 1995). Qualquer
  outro devolve 401 com `MISSING_TOKEN`, inclusive ticker que não existe: sem token não dá para saber.
- `/api/quote/HGLG11` sem token: 401. FII no plano grátis com token **não foi testado**.
- `/api/v2/fii/dividends` responde sem token para MXRF11 e HGLG11 (cerca de 12 meses) e 401 para KNRI11.
- `regularMarketTime` veio com hora de sábado, 31/10/2026 12:33: é a hora da última atualização da fonte, não do
  último negócio. `quoted_at` pode cair em dia sem pregão.

## Riscos aceitos

- **Licença do plano grátis.** A página de preços descreve o plano como "para validar a integração", a FAQ o
  indica para "protótipos sem receita" e sugere o Startup para MVP, e os termos proíbem "revender, redistribuir
  ou sublicenciar" os dados. O OrganizeUp cobra das famílias. O fundador precisa decidir o plano antes de
  colocar um token em produção. Sem token nada quebra.
- **Plano grátis não cobre o produto.** Histórico de 3 meses, cotação a cada 30 minutos, FII detalhado só no Pro.
  Com token grátis, o histórico de proventos pode ser menor que o dos tickers de teste.
- **Quantidade não acompanha evento em ações.** Depois de um desdobramento, o preço automático cai e a
  quantidade fica, e o patrimônio aparece errado até a família corrigir. Antes o preço digitado escondia isso. O
  aviso existe, mas o conserto de verdade é o ajuste automático, que segue fora do escopo.
- **Data de pagamento alterada na fonte** vira um provento novo, e o antigo fica. É raro, e a família pode excluir.
- **Precisão de `numeric(20,8)`.** A fonte traz até 12 casas; o erro fica abaixo de meio centavo em 1 milhão de
  ações.
- **Preço da família dura até a próxima cotação.** Quem discorda do preço automático digita o seu e ele some no
  dia útil seguinte.

## Fora do escopo por enquanto

Ajuste automático de desdobramento, grupamento e bonificação. Usar CDI, SELIC e IPCA em renda fixa. Importação
da B3. Atualização da cotação durante o pregão.

## Fontes

- brapi: documentação em `brapi.dev/docs`, OpenAPI em `brapi.dev/openapi.json`, `brapi.dev/pricing`,
  `brapi.dev/legal/terms-of-use`, consultados em 2026-10-31.
- SGS: `api.bcb.gov.br/dados/serie/bcdata.sgs.{série}/dados`, testado em 2026-10-31. A página de dados abertos do
  Banco Central não abriu; os códigos foram conferidos pelos valores devolvidos.
- Lei Complementar 224/2025: `planalto.gov.br/ccivil_03/leis/lcp/lcp224.htm`.
- Lei 15.270/2025: `planalto.gov.br/ccivil_03/_ato2023-2026/2025/lei/l15270.htm`.
- Lei 11.033/2004, art. 3º, com a redação da Lei 14.754/2023, art. 41: conferida em cópia da legislação (a
  página do Planalto não abriu).
