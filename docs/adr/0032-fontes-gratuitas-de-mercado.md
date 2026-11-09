# ADR-0032 — Fontes gratuitas de mercado: Yahoo para cotação, B3 para rendimentos de FII

Status: aceito (2026-11-09). Pedido do fundador: a brapi é cara e o plano atual recusou o MXRF11
(`sem_plano`); a coleta precisa ser automática e diária para todos os ativos de todas as famílias.

## Decisão

- O job `market-data` (ADR-0017) continua o mesmo: roda às 18:30 nos dias úteis e às 03:30 de terça a
  sábado, percorre as famílias ativas, soma os tickers distintos e consulta cada um uma vez. O que muda
  é **de onde vem o dado**:
  - **Cotação: Yahoo Finance** (`query1.finance.yahoo.com/v8/finance/chart/{TICKER}.SA`), sem chave.
    Preço, variação do dia e horário do pregão. Ações, FIIs, ETFs e BDRs.
  - **Rendimentos de FII: B3**, lista de fundos listados (`fundsProxy/fundsCall/GetListedSupplementFunds`),
    sem chave. Traz data-com (`lastDatePrior`), data de pagamento e valor por cota, em formato
    brasileiro (`dd/mm/aaaa`, vírgula decimal), convertidos na borda. Amortização e linha sem data de
    pagamento ficam de fora, como já era.
  - **brapi vira opcional.** Com `BRAPI_TOKEN`, ela continua a primeira fonte (traz desdobramentos e
    proventos de ações); o que ela recusar (`plano`, `nao_encontrado`) ou não couber na cota do dia vem
    das fontes gratuitas. Sem token, tudo vem delas.
  - Ticker marcado `sem_plano` pela brapi volta a ser consultado na rodada seguinte, sem esperar os 30
    dias. `desconhecido` só quando as fontes gratuitas também não acham.
- Índices (CDI, SELIC, IPCA) e câmbio seguem no Banco Central (ADR-0017 e ADR-0020). O catálogo de
  ativos segue na rota pública da brapi, que não exige token.
- As rotas do Yahoo e da B3 são as que os próprios sites usam, sem contrato público. Por isso toda
  resposta passa pelo zod: formato diferente vira erro `formato` e aviso no painel, nunca dado errado
  gravado. O `user-agent` identifica o OrganizeUp; o token da brapi nunca é enviado a elas.
- As tabelas, as regras de direito e de imposto e as telas não mudam; só o campo `source` (`yahoo`,
  `b3`, `brapi.dev`).

## Fora por enquanto

- **Proventos de ações sem brapi.** A B3 tem a rota de empresas listadas, mas a busca é por nome de
  pregão e os pagamentos recentes vêm sem data definida; o Yahoo traz só a data ex. Sem data de
  pagamento não gravamos (ADR-0017). Com `BRAPI_TOKEN` continuam vindo da brapi.
- Eventos em ações (desdobramento, grupamento, bonificação) sem brapi: o Yahoo não os trouxe nos testes.
- Raspagem de sites como StatusInvest ou Investidor10: os termos de uso proíbem coleta automatizada, o
  HTML muda sem aviso e o dado deles vem da B3. Não é fonte.

## Fontes conferidas em 2026-11-09

| Rota                                                                                          | O que devolve                                                         |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `GET query1.finance.yahoo.com/v8/finance/chart/MXRF11.SA?range=5d`                            | `meta.regularMarketPrice` 8,80, `regularMarketTime`, `currency` BRL   |
| `GET sistemaswebb3-listados.b3.com.br/fundsProxy/fundsCall/GetListedSupplementFunds/{base64}` | `cashDividends[]` com `lastDatePrior`, `paymentDate`, `rate`, `label` |

Payload da B3: `{"cnpj":"0","identifierFund":"MXRF","typeFund":7}` em base64. Testes com as respostas
gravadas em `packages/agents/test/market-free.unit.test.ts`.
