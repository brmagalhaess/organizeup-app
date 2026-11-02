# ADR-0024 — Importar a carteira da B3 e da corretora

Status: aceito (2026-11-01). Etapa 1 de `docs/specs/conexao-de-contas.md`.

## Decisão

- **O arquivo não sai do navegador** (ADR-0006). Excel e PDF são lidos no cliente; ao servidor só vão as operações
  já lidas, validadas com zod. Nota de corretagem traz nome e CPF: `parseBrokerageNotes` extrai número, data, negócios
  e taxas e descarta o resto. Nada do arquivo chega ao modelo de IA, a log, a `ops` ou ao banco.
- **Formatos**: Negociação, Movimentação e Posição da Área do Investidor (`packages/domain/src/b3-spreadsheet.ts`) e
  nota no padrão SINACOR (`brokerage-note.ts`), com as fontes citadas lá. Layout que não bate é recusado inteiro.
- **Sem coluna nova.** A B3 não dá identificador comum à Negociação e à nota, então guardar uma impressão digital de
  linha não resolveria. A identidade é a operação: ativo, sentido e data. Primeiro iguala quantidade e preço, linha a
  linha, como multiconjunto, para duas ordens iguais no dia continuarem sendo duas. O que sobra no dia só é a mesma
  operação se o número de linhas mudar e as somas fecharem, que é o caso da nota que agrupa negócios. Sobrou sem
  fechar, ou há a mesma quantidade a até 4 dias: `conferir`, desmarcado.
- **A confirmação reconfere.** A prévia não é confiável: `planInvestmentImport` roda de novo dentro da transação, sob
  `pg_advisory_xact_lock` da família, e só grava o que ele mandar. Dois envios seguidos gravam uma vez.
- **Taxas da nota** somam ao custo, rateadas pelo valor das linhas, sem IRRF. Se a operação já existe sem taxa e sem
  lançamento em conta, a nota completa a taxa. O líquido da nota precisa fechar com operações mais custos; senão as
  linhas ficam desmarcadas e a taxa não entra em operação já registrada.
- **Movimentação**: só "Transferência - Liquidação" vira operação, com a data de negócio estimada em D-2 úteis, sem
  feriado. "Transferência" sozinha é troca de corretora. Evento em ações fica com `investment_stock_events`.
- **Proventos da Movimentação são ignorados, com aviso.** O arquivo não separa bruto de retido com segurança, e uma
  linha da família a até 5 dias faz `reconcileProventos` pular todos os proventos daquele ativo na janela, inclusive
  o JCP pago no mesmo dia. O job de mercado continua sendo a fonte.
- **Posição não vira operação sozinha.** Ela não traz data nem preço pago, e o preço de fechamento como custo
  inventaria resultado. Serve para conferir; no que falta, entra uma compra com o preço que a pessoa digitar.
- **Ativo novo** vem de `market_assets`. Fora do catálogo, a pessoa escolhe o tipo; final 11 não tem padrão, porque pode
  ser FII, ETF ou unit. A nota traz nome e não código: só um candidato no catálogo ou na carteira resolve, senão a
  pessoa informa.
- **Dado informado** (regra 7): quem confirma é a pessoa, na prévia. Conta de origem é opcional e nasce vazia.
- **Limites**: 5 MB, 2.000 linhas, tipo pelo conteúdo, zip bomb pelo diretório central (`checkDebtFile`). Fórmula nunca
  é avaliada: número e código só passam por formato estrito, e texto com cara de fórmula é descartado.

## Consequências

Excluir uma operação importada e reenviar o arquivo cria de novo, o que é o esperado. Compra pela Posição seguida da
Negociação do mesmo período duplica, e a tela avisa, porque nada no banco marca a origem; marcar exigiria coluna lida
por toda a carteira. Não há Desfazer por lote: cada operação se exclui na tela de Lançamentos.

## A conferir com arquivo real

Nada foi testado com arquivo real. Colunas da Posição não têm fonte pública. Valor da liquidação em D+2, grafia dos
tipos de Movimentação, títulos da nota por corretora e o nome do catálogo da brapi contra a especificação da nota.
