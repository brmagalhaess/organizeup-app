# ADR-0033 — Histórico de cotações, coleta por hora no pregão e proventos semanais

Status: aceito (2026-11-09). Pedido do fundador: guardar as cotações coletadas hora a hora e os
proventos como histórico, coletar uma vez por ativo para todas as famílias, as telas lerem só o banco
e a coleta gastar só com a bolsa aberta.

## O que já era assim

As tabelas de mercado são globais (ADR-0017): um ticker é consultado uma vez e vale para todas as
famílias; as telas só leem o banco; `market_dividends` já é histórico com chave natural, nunca
alterado por coleta nova. O que faltava era o histórico de **preço** e uma cadência por tipo de dado.

## Decisão

- **`market_quote_history`** (migração 0043): uma linha por coleta (`ticker`, `quoted_at`, `price`,
  `source`), chave `(ticker, quoted_at)`, append-only. `market_quotes` continua com a última cotação
  para leitura rápida; `saveMarketQuote` grava nas duas. Repetir a mesma cotação (bolsa fechada,
  feriado) não duplica.
- **Cadência por tipo de dado**, no mesmo job `market-data`:
  - `quotes` (novo): a cada hora cheia das 10h às 17h, de segunda a sexta, só cotação, sem índices,
    câmbio, catálogo nem proventos. Ticker consultado há menos de 50 minutos fica de fora.
  - `full`: 18:30 (fechamento) e 03:30 (madrugada), como antes: índices, câmbio, catálogo, cotação e
    proventos.
  - **Proventos de FII pela B3: uma vez por semana por ativo** (`market_tickers.dividends_retry_on`),
    só na rodada `full`. Anúncios de FII são mensais em dia irregular; semanal pega tudo com folga, e a
    chave natural impede duplicar. Pela brapi, quando há token, a cotação já traz os proventos na mesma
    chamada; a rota extra de FII segue com a regra de 30 dias em caso de `plano`.
- **Feriados da B3** não são conhecidos pelo sistema: nesses dias a coleta horária repete a última
  cotação do Yahoo e nada é gravado de novo. Vale uma tabela de feriados no futuro.
- **Só quem tem dono**: o job continua coletando apenas tickers presentes em carteiras de famílias
  ativas (ADR-0017). Ativo que ninguém tem deixa de ser consultado sozinho.
- **Compactação**: nada é apagado por enquanto (regra 3 do AGENTS.md). Com ~9 coletas por ativo por
  dia útil, 100 ativos geram ~20 mil linhas/mês. Quando valer a pena, uma rotina por ADR mantém só o
  fechamento para coletas com mais de 90 dias.

## Uso previsto do histórico

- Gráfico de evolução da carteira e patrimônio de meses passados com o fechamento daquele dia em vez
  de estimativa; "atualizado às 15:00" nos dias de pregão. A leitura é `listMarketQuoteHistory`.
- Nenhuma tela muda neste ADR; a primeira a usar o histórico entra em PR próprio.
