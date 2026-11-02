# Painel por mês

Pedido do fundador em 2026-11-01. A tela `/app` passa a mostrar qualquer mês, com receitas, despesas, categorias, contas,
evolução, proventos e investimentos. As contas ficam em `packages/domain/src/dashboard.ts`; as somas continuam nas funções de
sempre (`summarizeMonth`, `spendingByCategory`, `incomeByCategory`, `summarizePortfolio`, `summarizeDividends`,
`tradesByMonth`), então painel, lançamentos e relatórios dão o mesmo número.

## Mês escolhido

- **Endereço:** `/app?mes=AAAA-MM`. Sem parâmetro, mês atual no fuso da família.
- **Faixa:** do primeiro mês com dado (lançamento, compra de cartão, operação, provento ou transferência) até 12 meses à frente
  do mês atual. Sem dado, começa no mês atual.
- **Inválido:** formato errado, parâmetro repetido, ou mês fora da faixa caem no mês atual, sem erro e sem redirecionar.
- **Controles:** seta de mês anterior, seta de próximo mês, lista de mês, lista de ano e "Hoje". "Hoje" só aparece fora do mês
  atual. Seta no limite da faixa fica desligada. Ao trocar o ano, o mês fica o mais perto possível dentro da faixa.
- **Três fases:** `passado`, `atual` e `futuro`. Mês futuro leva o selo "Previsto" e os rótulos dizem previsto.

## Blocos, nesta ordem

1. **Cabeçalho:** saudação, data de hoje, cidade e "Ver lançamentos".
2. **Seletor de mês.**
3. **Primeiros passos**, enquanto faltar algo. Some sozinho.
4. **Aviso do mês**, quando precisa: mês atual sem movimento, com link para o anterior; mês passado sem nada; mês futuro.
5. **Resumo.** Campos: receitas, despesas, resultado (receitas menos despesas) e saldo.
   - Receitas e despesas mostram o realizado. A dica traz a comparação com o mês anterior, em texto, e o que está em aberto.
   - Mês futuro mostra o previsto, e o rótulo diz isso.
   - Saldo: mês passado, saldo no último dia, com a cotação daquele dia. Mês atual, saldo de hoje e a previsão para o fim do mês.
     Mês futuro, saldo de hoje mais os previstos do mês atual até o escolhido.
   - Abaixo, em uma linha cada: quanto das despesas é aporte ou meta, quanto das receitas é resgate ou meta, e quanto do cartão
     está na fatura do mês.
6. **Dicas e sugestões** (quando houver).
7. **Evolução e próximos vencimentos.** Doze meses até o escolhido, receitas e despesas no mesmo eixo, feito cheio e previsto
   claro, mês escolhido destacado. Cada mês é um link para ele. Tooltip e tabela para leitor de tela. Próximos vencimentos
   segue a data de hoje; fora do mês atual, o título diz isso.
8. **Por categoria.** Despesas e receitas, as maiores 6 e "Outras". Valor, percentual e barra com feito e previsto. Cada linha abre
   `/app/lancamentos` filtrado. Despesa abre o cartão compra a compra, como no relatório de categorias, e soma feito e previsto.
9. **Por conta.** Cada conta com receitas, despesas e saldo. Conta arquivada só aparece se teve movimento no mês. Cada cartão com
   a fatura do mês, a situação dela e o que já está nas faturas seguintes. A fatura paga entra nas despesas da conta que paga: a
   linha do cartão é detalhe e não soma de novo.
10. **Investimentos.** Em todo mês: aportes e resgates do mês, das operações. Em mês passado: valor aplicado até o fim do mês,
    calculado das operações, com o rótulo "histórico". Carteira, ganho e divisão por classe são sempre a posição de hoje, com o rótulo
    "hoje": não existe histórico de preço (`market_quotes` guarda só a última cotação).
11. **Proventos.** Recebidos no mês, anunciados com pagamento no mês, anunciados depois dele e total dos 12 meses até o escolhido.
    Estimativa pelo histórico aparece à parte, com esse nome, do mês atual em diante. Só para família em real, como a tela de proventos.
12. **Reserva e patrimônio.** Sempre a posição de hoje; fora do mês atual, o título diz "hoje".

## Regras da conta

- **Mesmos números.** Receitas e despesas são `summarizeMonth` sobre `buildMonthEntries`, com as previsões, faturas, parcelas, metas
  e rendas, como em `/app/lancamentos` e no relatório de Resumo.
- **Aporte é movimentação.** Como nos relatórios, aporte, resgate e parcela de meta ficam nos totais do mês, na categoria deles. A
  tela diz quanto é isso: não é consumo.
- **Transferência** não é receita nem despesa. Só mexe no saldo das duas contas.
- **Cartão.** Compra vira despesa quando a fatura é paga. Fatura aberta é despesa prevista, na data de vencimento.
- **Moeda estrangeira.** `amount` já está na moeda principal, com a cotação congelada no lançamento. O saldo de mês passado converte
  o saldo na moeda da conta pela cotação do último dia do mês (ou a última anterior). Sem cotação, a conta fica fora da soma e a tela
  diz qual moeda faltou.
- **Conta arquivada** fica fora do saldo total, como hoje em Contas.

## Estados

- **Conta nova, sem nada:** primeiros passos, um convite curto para o primeiro lançamento e uma lista curta do que aparece depois.
  Nenhum zero solto.
- **Mês sem movimento:** o aviso explica, e os blocos vazios viram uma linha.
- **Módulo sem dado:** convite curto com link, nunca bloco vazio grande.
- **Carregando:** `loading.tsx` com o desenho do painel.
- **Erro:** a tela de erro do grupo `(painel)`, como nas outras telas.
- **Leitura só:** quem não pode gravar não vê os botões de confirmar.

## Desempenho

Lançamentos só do período: os 12 meses até o escolhido e os meses em volta de hoje, em dois intervalos. Compras de cartão só as que
têm parcela nesse período. Saldo por `sum` no banco. Proventos da janela usada. Operações inteiras, porque a posição depende delas.
