# ADR-0021 — Relatórios da família

Status: aceito (2026-11-01). Pedido do fundador.

Soma ao ADR-0015 (o agente `relatorios` entra na rodada diária, por último), ao ADR-0018 (rota nova `relatorios`) e ao
ADR-0020 (chave e valores, moeda da família). Aporte e resgate fora de despesas e receitas, e a regra na assinatura: ver ADR-0027.

## Decisão

### Dez relatórios, uma forma só

- **Tipos:** resumo do mês, gastos por categoria, fluxo de caixa, patrimônio, investimentos, proventos, dívidas, metas e
  viagens, aposentadoria e anual. Mês é `AAAA-MM`; ano é `AAAA`.
- **`StatementData` é igual para todos:** números (`figures`), seções com colunas e linhas (`sections`) e notas (`notes`),
  em `packages/domain/src/household-statement.ts`. Cada célula tem o tipo junto (`{ money }`, `{ month }`, `{ category }`).
  A tela, o PDF, o CSV e o assistente leem a mesma estrutura, e nenhum precisa conhecer cada relatório.
- **Valores e chaves, nunca frase.** `message_key` e `message_params`, como os outros agentes, e os rótulos em
  `relatorios` nos catálogos. Quem formata é quem mostra, no idioma de quem lê e na moeda da família. Chave que a versão não
  conhece fica sem frase: tela antiga não quebra com worker novo.
- **Mesmas contas do painel.** O agente chama `buildMonthEntries`, `summarizeMonth`, `spendingByCategory`,
  `summarizePortfolio` e `summarizeDividends`. Painel e relatório batem por construção, inclusive no que o painel
  faz: "gastos por categoria" soma feito e previsto e abre o cartão por compra, e a nota diz isso.
- **Média de 12 meses** usa só os meses com movimento: mês sem nada não dilui quem acabou de começar.
- **`household_reports` é outra coisa:** o que cada agente fez no dia. Relatório da família vive em `household_statements`.

### Agente `relatorios`

- **Último da rodada,** depois de todos os outros, uma família por transação. Só grava dado derivado.
- **Dia 1 fecha o mês anterior; em janeiro, o ano.** Nos outros dias, atualiza o mês corrente e o ano corrente, parciais. No dia
  1 só fecha: o mês novo aparece no dia seguinte.
- **Perdeu o dia 1?** A rodada seguinte fecha o que ficou parcial para trás.
- **Primeira rodada preenche o passado** onde há data de verdade (resumo, categorias, fluxo, patrimônio e proventos, 12
  meses), para a família ter o que comparar, e o ano anterior. Investimentos, dívidas, metas e aposentadoria são fotos de
  hoje: nascem no fechamento e não têm passado.
- **Mês fechado não muda sozinho.** `source_hash` é a assinatura do que a família lançou no período, e só ela reabre o mês:
  lançamentos e compras do cartão (resumo, categorias, fluxo), proventos da família (proventos), operações (investimentos),
  parcelas pagas (dívidas), parcelas de meta (metas) e a foto do mês (patrimônio). Aposentadoria não reabre: é a foto do
  fechamento. A rodada confere a assinatura de todo relatório dos últimos 12 meses, de qualquer tipo. Regenerou: `revised_at` vira "atualizado em", na tela e nos arquivos, e o parágrafo sai, porque falava de
  outros números.
- **O que um agente faz não reabre.** Categoria entra na assinatura só quando a família escolheu uma específica. Mudança do
  agente de categorias e provento automático do mercado não contam: senão mês fechado mudaria toda noite.
- **Idempotente.** Fechado com a mesma assinatura nem é calculado. Parcial compara com o que está gravado, por um JSON com as
  chaves em ordem (o `jsonb` não guarda a ordem), e não grava se for igual. `generated_at` só muda quando algo mudou.
- **Tudo apagado:** a linha sai, por isso a tabela tem política de DELETE. Relatório vazio não fica na tela.
- **Horário:** roda na rede de segurança das 05:30, por último, e antes das dicas das 05:45. O Paperclip confere às 05:40.
  Sentinela do boot passa a ser `relatorios`, o último ligado.

### Parágrafo "O que mudou"

- **Opcional, por `packages/ai/src/relatorios.ts`, fora de `withHousehold`,** logo depois do agente, na mesma rodada. Portão igual
  ao das dicas, com `INSIGHTS_CONSENT_VERSION`: mesmos dados, mesmo operador, mesma finalidade. Sem aceite, o relatório sai igual.
- **Rota `relatorios`, esforço `low`, modelo atual, sem ferramentas.** Só o período que acabou de fechar ganha parágrafo: o
  passado preenchido na primeira rodada já nasce com `narrated_at` marcado e não gasta modelo.
- **No máximo uma chamada por relatório fechado.** `narrated_at` guarda isso, mesmo quando a resposta é reprovada e mesmo
  depois de o mês regenerar. O teto do serviço e o da família são conferidos antes de cada chamada. Erro da API não marca: tenta
  na noite seguinte.
- **O verificador é o da madrugada** (`rejectionOf`): número fora do relatório, ativo, ordem de compra ou venda, nome e
  instrução reprovam, e nada é gravado. Texto livre vai como `dado_nao_confiavel`, depois do filtro de nomes.
- **Idioma de quem definiu o aceite,** em `what_changed_locale`, marcado em `lang` na tela. O texto é do modelo e fica num idioma
  só, como as dicas.

### Tela e arquivos

- **`/app/relatorios`** com tipo, período e comparação no endereço. Sem pedido, abre o resumo no período mais novo e compara
  com o anterior. Gráficos só com CSS, um eixo, nas cores do sistema, e tabela logo abaixo. `Insights` continua: a dica é a da
  tela do mesmo assunto, porque a lista de telas em `household_insights` é um CHECK fechado, e trocar não seria aditivo.
- **Baixar:** `/app/relatorios/baixar`, autenticada, lê pela RLS, `private, no-store`. Relatório de outra família dá 404, como
  um que não existe.
- **PDF com jsPDF 4.2.1.** Empacota no Next sem configuração e sem arquivo de fonte, e cobre os três idiomas com as fontes
  padrão do PDF. `pdfkit` lê arquivos de fonte do disco e pediria `serverExternalPackages`; `pdf-lib` está parado desde 2022;
  `@react-pdf/renderer` é bem mais pesado.
- **CSV:** `;` e vírgula decimal em português e espanhol, `,` e ponto em inglês, com BOM, para abrir certo na planilha. Valores
  saem como número, com a moeda no cabeçalho. Texto digitado que começa com `=`, `+`, `-` ou `@` ganha `'`, para não virar
  fórmula.
- **Moeda:** `householdCurrency` lê `main_currency` quando a coluna existir (migração 0033, de outra frente) e senão
  `household_settings.currency`, por `to_jsonb`, sem depender da ordem em que as duas entram.
- **`ver_relatorio`** é uma ferramenta de leitura, a 14ª com `strict` de um limite de 20.

## Fora do escopo por enquanto

Relatório enviado por e-mail. Escolher um intervalo livre de datas. Tradução do parágrafo já escrito. Marca da família no PDF.
Agente no Paperclip e cartão dele na equipe do painel (`paperclip.ts`): ficam com o fundador.

## Riscos aceitos

- **Foto de hoje no fechamento.** Investimentos, dívidas, metas e aposentadoria mostram a posição do dia em que o relatório foi
  gerado, não a do último dia do mês: não há histórico diário dessas posições. Regenerar por lançamento antigo usa a posição
  daquele dia. A nota de investimentos diz isso.
- **Patrimônio fechado com o detalhe do dia 1.** Até o dia 3, o detalhe vem da foto do dia. Depois, e no passado, só os totais
  de `net_worth_snapshots`, e a nota avisa.
- **Mudar a moeda principal** não reescreve os relatórios, como nada é reescrito no ADR-0020: o valor gravado passa a aparecer
  na moeda nova até a próxima regeneração, exatamente como os lançamentos.
- **Nome fora das fontes padrão** do PDF, como emoji ou alfabeto não latino, sai como `?`. Embutir uma fonte Unicode pesaria mais
  no servidor do que o caso justifica.
- **Mudança de categoria pela própria família** num lançamento em categoria genérica reabre o mês: é escolha dela.
- **Provento automático que chega depois do fechamento** só aparece no mês fechado se a família lançar algo em proventos
  naquele mês. É o preço de "não muda sozinho".
