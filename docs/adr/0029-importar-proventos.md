# ADR-0029 — Importar proventos

Status: aceito (2026-11-02). Tela em `docs/specs/importar-proventos.md`. Muda a frase do ADR-0024 sobre proventos da
Movimentação só nesta tela: a importação da carteira segue ignorando essas linhas, e o job de Mercado continua sendo
quem preenche sozinho.

## O conflito

`reconcileProventos` pula todos os proventos de um ativo a até 5 dias de qualquer linha com `market_dividend_id` nulo.
Isso existe porque a família pode lançar numa linha só o total de JCP e dividendo (ADR-0017), e essa regra continua
valendo. Uma linha importada do jeito antigo cairia nela: duplicaria nada, mas tiraria da carteira o JCP pago no mesmo
dia e tudo o que o Mercado achasse depois.

## Decisão

- **Sem migração.** A marca da linha importada é o prefixo `importado-` no `id` de `dividends` (`isImportedDividend`).
  `source` tem `CHECK` e aceitar outro valor exigiria derrubar a restrição. Coluna nova em `dividends` passaria por todo
  `select()` da tabela, inclusive do painel, e quebraria a web com o banco atrasado. Tabela ao lado traria RLS e leitura
  em dois lugares para guardar um único bit. O `id` é texto opaco, ninguém o interpreta fora dessa função, e o prefixo
  não muda nenhuma leitura. Se um dia outro dado da origem for preciso, uma coluna preenchida a partir do prefixo
  resolve.
- **Linha importada responde por um provento só.** Fica fora da regra dos 5 dias. Em `reconcileProventos`, cada linha
  importada reivindica um provento da fonte do mesmo tipo a até 5 dias, o mais perto da data e, no empate, o de valor
  mais próximo. O reivindicado não é criado; todos os outros são. Assim, a importação que chega antes do Mercado não
  duplica nem bloqueia. Quem lançou à mão segue na regra antiga, sem mudança.
- **Dividendo e rendimento contam como o mesmo tipo ao comparar** (`sameProventoKind`), porque a B3 e a fonte de mercado
  podem dar nomes diferentes ao pagamento de um FII. JCP é sempre separado: o imposto é outro.
- **Mercado primeiro.** A linha automática igual, com um centavo de folga, sai como "já existe". A soma de várias
  linhas também vale: a mesma ação em duas corretoras vem em duas linhas e no Mercado é uma. Valor diferente fica em
  conferir. Se a pessoa marcar, a linha automática recebe o valor do arquivo, passa a `source = 'familia'` e mantém
  `market_dividend_id`. O job não mexe em linha `familia` e entende que aquele provento já tem resposta. É dado informado
  (regra 7): o aceite está na prévia.
- **A confirmação reconfere.** `planDividendImport` roda de novo dentro da transação, sob a trava da família
  (`lockFamilyImport`), a mesma da importação da carteira, e só grava o que ele mandar. O job de Mercado toma a mesma
  trava antes de ler, para não decidir em cima de uma foto de antes da importação.
- **Identidade.** Linha por linha, por investimento, tipo compatível, a até 5 dias e valor. Dois lançamentos iguais no
  mesmo dia seguem sendo dois, porque cada linha gasta uma linha do banco. Sem coluna de impressão digital, pelo mesmo
  motivo do ADR-0024: a B3 não dá identificador.
- **Valor.** O que o arquivo traz é a verdade, e bruto, retido e líquido fecham em um centavo ou a linha é ignorada.
  - Só líquido em JCP: bruto e retido saem da regra de `proventoAmounts`, com a alíquota de `jcpRateOf`. O bruto vem do
    inverso, e `proventoAmounts` confere que o líquido bate. A linha diz o que foi calculado.
  - O arquivo não traz data-com, e ela decide a alíquota na virada de 2025 para 2026. Com pagamento antes de 2026, é 15%.
    Do contrário, a data-com vem do provento da fonte, se houver um por perto. Sem ela, a linha fica em conferir: se a
    pessoa marcar, grava o líquido do arquivo como bruto, sem imposto, e a tela avisa. Não inventamos alíquota.
  - Rendimento fora de FII segue a mesma recusa de `proventoAmounts`.
  - Só líquido em dividendo, com mais de R$ 50 mil no mês da mesma empresa: conferir, porque pode haver retenção de 10%.
  - "Valor da Operação" e "Valor líquido" são tratados como líquido. Coluna só de "Valor" no CSV, também.
- **Provento não vira lançamento nem receita.** A tela de Proventos nunca criou lançamento em conta, e a importação
  segue a mesma regra, sem opção. Quando a tela ganhar a escolha, a importação pode ganhar também.
- **Ativo fora da carteira** nunca cria posição. A pessoa escolhe um investimento, ou a linha fica de fora. Código
  com mais de um investimento na família cai no mesmo caso.
- **Provento excluído antes** (linha `desfeita`) fica em conferir: a família já disse não uma vez. Se marcar, entra como
  linha importada, e o bloqueio do automático segue valendo.
- **O arquivo fica no navegador** (ADR-0006, ADR-0024). `ParsedDividend` só tem código, tipo, data e valores; o zod do
  servidor repete o formato estrito e descarta o resto. Linhas ignoradas, com o rótulo do arquivo, nunca são enviadas.
  Fórmula não é avaliada: número e código só passam por formato estrito.
- **Reaproveitável.** `parseDividendFile` e `planDividendImport` são puros, em `packages/domain`, para o importador
  inteligente chamar. Sem IA aqui.

## Consequências

- "Rendimento - Transferido" e os iguais de dividendo e JCP são ignorados, porque repetem outra linha do extrato.
- "Reembolso" é ignorado com motivo: a tabela só aceita dividendo, JCP e rendimento, e o reembolso de ação emprestada
  pede que a pessoa diga o que foi.
- Excluir um provento importado libera o automático: na rodada seguinte, o Mercado cria o dele. Excluir a linha trocada,
  que tem `market_dividend_id`, bloqueia o automático para sempre, como qualquer exclusão de automático.
- Duas linhas importadas iguais reivindicam dois proventos, se houver. Uma linha que soma dois pagamentos do mesmo dia
  reivindica só um, e o outro é criado: a família vê e exclui. É raro e aparece na tela.
- Data do arquivo a mais de 5 dias do pagamento da fonte é outro provento para o job, como já acontece com o lançamento
  à mão. Não há Desfazer por lote; cada linha se exclui na tela de Proventos.

## A conferir com arquivo real

Nada foi testado com arquivo real.

- Colunas de "Proventos recebidos": vêm de um projeto público e de uma página de ajuda, não da B3. Há relato de que o
  documento vem "separado por mês": lemos todas as abas e pulamos linha de título e cabeçalho repetido, sem ter visto.
- Se "Valor da Operação" é mesmo líquido no JCP da Movimentação, e no dividendo acima de R$ 50 mil.
- Grafia dos tipos: "Juros Sobre Capital Próprio", "Rendimento", "Dividendo" e os "- Transferido".
- Se a data de pagamento do arquivo coincide com a da brapi, e se FII vem como rendimento nos dois.
- Sinal do "- Transferido": uma fonte o mostra como débito, outra só diz que repete. Ignoramos nos dois casos.

## Fontes

Consultadas em 2026-11-02.

- Colunas de "Proventos recebidos", com linhas fictícias nos testes: `backend/app/services/extrato_b3.py` e
  `backend/tests/test_extrato_b3.py` em github.com/Cristianosm91/Controle_Investimentos. O mesmo projeto diz que o valor
  desse relatório já é líquido.
- Caminho Proventos, Recebidos, Baixar, e a lista produto, pagamento, tipo de evento, quantidade, preço unitário e valor
  líquido: central de ajuda da Warren (faq.warren.com.br, "Como encontrar os relatórios auxiliares da B3"). A página
  recusou leitura direta; o trecho veio do resultado de busca.
- Linha de total "Total líquido": github.com/tbc174/tickerlab, pull request 252, sobre o arquivo de proventos a receber.
- Tipos da Movimentação, com "- Transferido" e "Reembolso": `src/importers/movimentacao_excel.rs` em
  github.com/kov/interest e `b3_movimentacao_parser.py` em github.com/lucasribeirof-create/apex.
- "Rendimento - Transferido" repete outro lançamento, e o JCP do extrato vem líquido: `crates/providers/src/b3_extrato.rs`
  em github.com/4nier-app/patrimonio. Débito: `backend/tests/test_classifier.py` em github.com/gustavobonassa/gumbinvest.
- Caminho Extratos, Movimentação: README de github.com/mcsscalabrin/i10-cli.
- Soma da coluna "Valor da Operação" para proventos em dinheiro: material da B3 citado em resultado de busca; o PDF
  (`Material_IR22_Area_logada_v4.pdf`) não pôde ser lido aqui.
