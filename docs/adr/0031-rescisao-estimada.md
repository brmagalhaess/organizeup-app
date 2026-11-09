# ADR-0031 — Rescisão estimada da renda CLT

Status: aceito (2026-11-09). Pedido do fundador: "em Renda deve ir calculando automaticamente, mês a mês, a
rescisão, só como informativo, até eu clicar em Lançar, para cada receita CLT".

## Decisão

- **Cálculo puro em `packages/domain/src/severance.ts`** (`calculateSeverance`), recebendo a tabela fiscal
  como `income.ts`. É uma **estimativa**, recalculada a cada abertura da tela com a data de hoje como saída.
  Nada é gravado até a família clicar em **Lançar rescisão**.
- **Entradas**: salário bruto, dependentes e pensão da renda; `jobStartedOn` do plano do ano; data da saída
  (hoje); motivo (dispensa sem justa causa, pedido de demissão, acordo); aviso prévio indenizado ou não;
  adiantamento do 13º já recebido no ano; saldo do FGTS informado (sem ele, estimado em 8% por mês de serviço).
- **Verbas**: saldo de salário (dias do mês da saída, convenção de 30 dias), aviso prévio indenizado, 13º
  proporcional, férias proporcionais com 1/3, multa e saque do FGTS. Aviso indenizado projeta o contrato
  para 13º e férias.
- **Impostos**: saldo de salário com INSS e IR mensal; 13º com INSS e IR exclusivo, como no fim do ano
  (ADR-0009); aviso indenizado e férias indenizadas com 1/3 isentos de INSS e IR.
- **Lançar**: cria um lançamento de receita realizado na conta e categoria da renda, com a descrição
  "Rescisão · {nome}", na data da saída, e encerra a renda no mês da saída (`endMonth`). O FGTS não entra
  no lançamento: é saque da conta vinculada, e a família o lança se quiser.
- **Fora**: férias vencidas não gozadas (precisariam do histórico de gozo), faltas, horas extras, adicionais,
  médias, aviso trabalhado com desconto, justa causa, estabilidades, seguro-desemprego, homologação.

## Fontes conferidas em 2026-11-09

| Regra                                                                      | Fonte                                                | Situação                               |
| -------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------- |
| Aviso prévio de 30 dias mais 3 por ano completo, até 90                    | Lei 12.506/2011, art. 1º e parágrafo único           | Confirmado                             |
| Aviso indenizado conta como tempo de serviço                               | CLT, art. 487, § 1º                                  | Confirmado                             |
| Acordo: metade do aviso indenizado e multa de 20%, saque de 80% do FGTS    | CLT, art. 484-A                                      | Confirmado                             |
| Multa de 40% do FGTS na dispensa sem justa causa; depósito de 8%           | Lei 8.036/1990, arts. 15 e 18, § 1º                  | Confirmado                             |
| 13º: 1/12 por mês com 15 dias ou mais, inclusive na rescisão               | Lei 4.090/1962, arts. 1º e 3º                        | Confirmado                             |
| Férias proporcionais com 1/3 na rescisão, 1/12 por mês com 15 dias ou mais | CLT, arts. 146, par. único, e 147; CF, art. 7º, XVII | Confirmado                             |
| IR do 13º exclusivo na fonte                                               | Lei 8.134/1990, art. 16                              | Confirmado (ADR-0028)                  |
| Aviso indenizado e férias indenizadas com 1/3 isentos de IR                | Lei 7.713/1988, art. 6º, V; Súmula 386 do STJ        | Confirmado para férias; aviso: leitura |
| Aviso indenizado e férias indenizadas fora da base do INSS                 | Decreto 3.048/1999, art. 214, § 9º, IV e V           | Confirmado                             |

O que está como "leitura" (isenção de IR do aviso indenizado) segue a Solução de Divergência COSIT 1/2009;
se a Receita orientar diferente, só muda a parte tributada em `calculateSeverance`.
