# ADR-0035 — Proventos e eventos de ações pela B3; brapi só no catálogo de nomes

Status: aceito (2026-11-09). Pedido do fundador: tirar a brapi, que exige chave paga, e ficar só com as
fontes que já usávamos de graça, B3 e Yahoo.

## Contexto

O ADR-0032 deixou a brapi opcional: sem `BRAPI_TOKEN`, cotação vinha do Yahoo e rendimentos de FII da B3,
mas **proventos e eventos de ações só vinham da brapi**, com chave. Na prática a produção rodava sem chave,
e a tela de Proventos mostrava só FIIs. Ao conferir as rotas da B3 em 2026-11-09, a lista de empresas
listadas devolve o que faltava: dividendos e JCP com data-com, data de pagamento e valor por ação, por
classe (ON, PN, unit), e os desdobramentos, grupamentos e bonificações, com o fator.

## Decisão

- **Proventos e eventos de ações: B3**, rota `listedCompaniesProxy/CompanyCall/GetListedSupplementCompany`,
  com `{"issuingCompany": "<raiz do código>", "language": "pt-br"}` em base64 (PETR4 → PETR). A resposta
  traz todas as classes da emissora, cada linha com o ISIN (`assetIssued`). O código de negociação sai do
  ISIN: `BR` + raiz + `ACN` + `OR` (ON → 3), `PR` (PN → 4), `PA`..`PD` (5..8); `CDAM` é unit (11). Séries
  antigas da mesma classe (`BRBBASA04OR8`) caem no mesmo código; debênture, recibo e BDR ficam de fora.
  Só entra o que é do código pedido.
- **Valor pago, sem ajuste.** A B3 informa o valor por ação da época; não há correção por eventos
  posteriores, então `paidRate` deixa de ser usado na coleta.
- **Fatores da B3** viram o multiplicador que a carteira já usa: desdobramento e bonificação vêm em
  porcentagem a acrescentar (`100` = 2 para 1, `3` = 3% de bonificação, fator `1 + pct/100`); grupamento
  já vem como multiplicador (`0,1` = 10 para 1). `CIS RED CAP`, subscrição e afins ficam de fora, como antes.
- **Rótulos**: `DIVIDENDO`, `JRS CAP PROPRIO` (JCP) e `RENDIMENTO`. Linha repetida em mais de uma série
  de ISIN entra uma vez; pagamentos iguais com valores diferentes ganham `seq`, como no ADR-0017.
- **Cadência**: a mesma dos rendimentos de FII (ADR-0033): uma vez por dia por ativo, na rodada completa,
  por `market_tickers.dividends_retry_on`. ETF e BDR só têm cotação.
- **A brapi sai da coleta**: `fetchBrapiQuote`, a rota de FII da brapi, o token, a cota diária
  (`BRAPI_MAX_CALLS_PER_DAY`, `market_usage`, "chamadas de hoje" no painel), os estados `sem_plano` e os
  erros `sem_token`, `token_invalido` e `plano`. `BRAPI_TOKEN` e `BRAPI_MAX_CALLS_PER_DAY` deixam de existir.
  A tabela `market_usage` fica, sem uso (regra 3 do AGENTS.md).
- **O que fica da brapi**: só o catálogo de nomes (`/api/quote/list`, rota pública, sem chave), que serve
  para achar o código pelo nome nas notas de corretagem e para a classe de um ativo novo. Decisão do
  fundador em 2026-11-09 ("só da coleta"). Trocar o catálogo pela lista de empresas da B3 (páginas de 120,
  com nome de pregão e raiz, sem os códigos) fica para um ADR próprio.

## Consequências

- Proventos de ações passam a aparecer para todas as famílias, sem chave e sem custo.
- O `source` dos proventos e eventos novos é `b3`; o que a brapi gravou continua como `brapi.dev`, e a
  chave natural evita duplicar.
- Como a B3 não traz `verified`, vale tudo o que tem data de pagamento e valor positivo, igual aos FIIs.
- Testes: respostas reais da PETR e da ITUB gravadas em `packages/agents/test/market-free.unit.test.ts` e
  `stock-events.integration.test.ts`; o job em `market.integration.test.ts` roda só com Yahoo e B3.
