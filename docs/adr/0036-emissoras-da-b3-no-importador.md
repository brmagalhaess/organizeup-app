# ADR-0036 — Emissoras da B3: o nome de pregão da nota vira código

Status: aceito (2026-11-10). Pedido do fundador: "criar um banco de dados com todos os ativos da
bolsa, com nome e ticker, e na importação pegar o código certo, porque com parte do nome já sabemos
qual é o ativo". Motivo: ao anexar notas de corretagem, muitas linhas paravam em "Falta o código do
ativo".

## Contexto

A nota de corretagem (padrão SINACOR) não traz o código: imprime o **nome de pregão** da emissora,
de até 12 caracteres, mais o tipo da ação e o segmento ("CAIXA SEGURI ON NM", "PETROBRAS PN N2",
"SANTANDER BR UNT"). O importador (ADR-0029, PR #28) tentava achar o código pelo catálogo de nomes da
brapi (`market_assets`), mas o nome de lá é a razão social, e cada corretora abrevia do seu jeito: o
acerto era raro.

A lista de empresas listadas da B3 (`listedCompaniesProxy/CompanyCall/GetInitialCompanies`, páginas
de 120, 30 páginas, sem chave) traz exatamente o nome de pregão, a razão social, a raiz do código
(`issuingCompany`, PETR), o segmento (NM, N1, N2) e o tipo: `1` ação negociada, `4` BDR, `7`
registro sem negociação. A lista de fundos (`fundsProxy/fundsCall/GetListedFundsSIG`) estava
respondendo vazia em 2026-11-10, e a página de FIIs do site da B3 dava erro 500.

## Decisão

- **Tabela global `market_issuers`** (migração 0046): `issuer` (raiz, chave), `trading_name`,
  `company_name`, `kind` (`acao` | `bdr`), `segment`, `code_cvm`, `source`, `updated_at`. Como as
  outras tabelas de mercado: todos leem, só o worker grava, ninguém apaga.
- **Coleta** na rodada completa do job `market-data`, junto com o catálogo: `fetchB3Issuers` percorre as
  páginas e guarda só `type` 1 e 4 com `status` A. Cerca de 900 linhas e 30 chamadas por dia.
- **Resolução** (`tickerOfIssuer`, em `packages/domain`): o título da nota vira nome de pregão
  normalizado mais o tipo; o tipo dá o final (ON 3, PN 4, PNA 5, PNB 6, PNC 7, PND 8, UNT 11) e a
  emissora dá a raiz. Só responde quando **uma** emissora bate e o tipo está no título. BDR fica de
  fora, porque o final (31 a 39) não sai do nome; FII também, porque a lista de fundos não respondeu.
- **Ordem** em `withResolvedTickers`: o código que a pessoa digitou, depois a emissora da B3, depois o
  catálogo da brapi e a carteira, como antes. Vale na prévia do lote (`judgeTrades`), na aprovação
  (`saveTrades`) e na importação manual de Investimentos.
- Sem texto novo de tela: "Falta o código do ativo" continua para o que ainda não resolver.

## Fora por enquanto

- Catálogo de FIIs pela B3 (quando a lista de fundos voltar a responder): o nome de pregão do fundo
  ("FII MAXI REN") daria o código pela sigla (`MXRF` + 11).
- BDRs pelo nome: precisaria do código completo, que só vem em `GetDetail` por empresa.
- Trocar o catálogo de nomes da brapi pela B3 (ADR-0035 deixou a brapi só nele).

## Consequências

- Notas de corretagem com ações passam a resolver o código sozinhas na leitura do lote, e a linha nasce
  marcada; a família não precisa digitar o código a cada nota.
- `packages/db` muda (migração aditiva e grants): risco alto, revisão reforçada.
