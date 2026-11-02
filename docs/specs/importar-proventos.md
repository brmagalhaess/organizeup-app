# Importar proventos

Pedido do fundador em 2026-11-02: Lançamentos e Investimentos têm importação, e Proventos também precisa ter. Decisões e
a conversa com o job de Mercado: [ADR-0029](../adr/0029-importar-proventos.md).

## Onde fica

`/app/proventos/importar`, módulo Investimentos, só para família em real. Entradas: botão na tela de Proventos e cartão
em `/app/importar`. Quem só pode ver não recebe o botão nem o cartão, e a tela diz que o papel não permite importar. Sem nenhum
investimento na carteira, a tela explica e leva para `/app/investimentos/importar`.

## Arquivos

Uma frase em cada um diz como baixar.

| Arquivo             | Como baixar                                                                                     | Colunas lidas                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Proventos recebidos | Área do Investidor da B3, Proventos, Recebidos, escolha o período e baixe em Excel.             | Produto, Pagamento, Tipo de Evento, Valor líquido                                      |
| Movimentação        | Área do Investidor da B3, Extratos, Movimentação, escolha o período e baixe em Excel.           | Entrada/Saída, Data, Movimentação, Produto, Valor da Operação                          |
| CSV                 | Exporte da sua planilha ou corretora, com uma linha por provento e uma linha de títulos no topo | Data, ativo, tipo e valor. Bruto, retido e líquido entram quando houver coluna própria |

Instituição, Quantidade e Preço unitário existem nos arquivos da B3 e não são lidos. Preço unitário vem arredondado e
não fecha com o valor, então não serve de base para o imposto.

Ficam de fora, sem chegar à prévia: Excel antigo (`.xls`), PDF, arquivo acima de 5 MB ou 2.000 linhas, e Excel com outro
layout. Cada caso tem mensagem própria. CSV sem as colunas reconhecidas abre a escolha de colunas. CSV sem linha de
títulos é recusado com a explicação do que precisa ter, para a primeira linha de dados não se perder como título.

## Passos e estados

1. **Escolher.** Campo de arquivo, frase de privacidade e como baixar cada um. Enquanto lê: "Lendo {arquivo}…". Erro:
   alerta com a mensagem e "Escolher outro arquivo".
2. **Escolher colunas**, no CSV que não foi reconhecido: data, ativo, tipo, e valor, líquido ou bruto, com retido
   opcional. Na prévia de qualquer CSV, "Trocar as colunas" volta aqui.
3. **Prévia.** Quatro números no topo e uma linha por linha do arquivo, nada gravado:
   - **Novo:** marcado.
   - **Já existe:** sem caixa. O provento já está lá, automático, importado antes ou lançado à mão.
   - **Para conferir:** desmarcado, com o motivo na linha:
     - valor diferente do automático, com os dois valores na linha; marcar troca pelo valor do arquivo;
     - outra linha do mesmo pagamento; entra só junto com a que troca o automático;
     - valor que dá para ler de mais de um jeito, como 1.234;
     - parecido com um lançamento à mão; marcar grava mais um;
     - imposto incerto; marcar grava o valor do arquivo, sem imposto;
     - possível retenção de dividendo acima de R$ 50 mil no mês da mesma empresa;
     - provento que a família excluiu ou desfez antes;
     - ativo fora da carteira, com a escolha do investimento.
   - **Ignorado:** sem caixa, com o motivo.
   - Valor calculado aparece na linha: "Calculado: bruto e imposto a partir do líquido, com JCP a 17,5%."
4. **Ativos fora da carteira.** Um seletor por código, com "Deixar de fora" e os investimentos da família. Nada cria
   posição. "Conferir com esta escolha" refaz a prévia, sem perder o que a pessoa marcou ou desmarcou.
5. **Confirmar.** "Importar N proventos", desligado com nada marcado. Em caso de erro, a mensagem aparece e nada foi
   gravado.
6. **Pronto.** Quantos entraram, quantos foram trocados e quantas linhas foram puladas porque mudaram depois da prévia, "Ver proventos" e "Importar outro arquivo".

Sem nada de novo, a prévia diz "Nada novo neste arquivo".

## Regras

- O arquivo fica no navegador. Ao servidor vão só código de negociação, tipo, data e valores, em formato estrito. CPF,
  nome, instituição e texto livre do arquivo não saem do navegador.
- Sem IA.
- Provento importado não cria lançamento em conta nem receita, como o formulário da tela de Proventos.
- Mesmo arquivo duas vezes, ou períodos sobrepostos, não duplica. A confirmação reconfere tudo, dentro da transação e sob
  a trava da família.
- Importar não duplica o que o Mercado criou e não bloqueia o que ele criaria depois.

## A conferir com arquivo real

Ver a seção de mesmo nome no ADR-0029.
