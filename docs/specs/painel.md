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

1. **Seletor de mês**, no cabeçalho fixo da tela, o mesmo de Lançamentos e dos calendários.
2. **Cabeçalho:** saudação, data de hoje, cidade e "Ver lançamentos".
3. **Aviso do mês**, quando precisa: mês atual sem movimento, com link para o anterior; mês passado sem nada; mês futuro.
4. **Resumo.** Campos: receitas, despesas, resultado (receitas menos despesas) e saldo. Com aporte ou resgate no mês, mais uma faixa:
   Aportado, Sobrou depois de aportar (resultado menos aportes) e Voltou para as contas.
   - Receitas e despesas mostram o realizado. A dica traz a comparação com o mês anterior, em texto, e o que está em aberto.
   - Mês futuro mostra o previsto, e o rótulo diz isso.
   - Saldo: mês passado, saldo no último dia, com a cotação daquele dia. Mês atual, saldo de hoje e a previsão para o fim do mês.
     Mês futuro, saldo de hoje mais os previstos do mês atual até o escolhido.
   - Cada número leva um ícone no canto, só de apoio.
   - Logo abaixo, uma barra mostra quanto das receitas do mês as despesas já consumiram (cheio) e quanto chegam a consumir
     com o que está em aberto (claro), com a frase que diz o mesmo. Sem receita no mês, a barra não aparece.
   - A faixa de aportes é menor que o resumo: são números de apoio.
   - Abaixo, em uma linha: quanto do cartão está na fatura do mês.
5. **Primeiros passos**, enquanto faltar algo. Na conta nova vêm antes de tudo, com os cinco passos. Depois que a pessoa
   começou, o bloco mostra a barra do progresso e só os passos que faltam.
6. **Dicas e sugestões**, quando houver.
7. **Evolução e próximos vencimentos.** Doze meses até o escolhido, receitas e despesas no mesmo eixo, feito cheio e previsto
   claro, mês escolhido destacado. Cada mês é um link para ele. Tooltip e tabela para leitor de tela. Próximos vencimentos
   segue a data de hoje, com os 4 mais próximos, 3 no celular; fora do mês atual, o texto diz isso.
8. **Lançamentos do mês.** Até 40 receitas e despesas do mês escolhido, realizadas e previstas, cada uma com data, descrição,
   valor e status (Realizado; Previsto; ou Atrasado quando prevista e a data já passou). Na ordem da tela de Lançamentos: hoje
   no topo, e o que ainda vai vencer depois. A lista tem altura fixa e rolagem própria, para caber ao lado dos gráficos. Link "Ver todos em Lançamentos" abre
   `/app/lancamentos` do mês escolhido. Passando de 40, um aviso abaixo da lista diz quantos itens ficaram de fora, com o mesmo
   link.
9. **Por categoria.** Despesas, receitas e, quando houver, aportes, as maiores 6 e "Outras". Valor, percentual e barra com feito e previsto. Cada linha abre
   `/app/lancamentos` filtrado. Despesa abre o cartão compra a compra, como no relatório de categorias, e soma feito e previsto.
10. **Gastos por pessoa**, quando alguma conta ou cartão tem dono (ADR-0040). Uma barra por pessoa, da que mais gastou
    para a que menos gastou, com o pago cheio e o que está em aberto claro, o valor, a fatia das despesas e a frase de quem
    gastou mais. "Uso comum" vem por último. Cada nome abre `/app/lancamentos` com as despesas daquela pessoa. Na lista de
    lançamentos do mês, cada linha leva o nome da pessoa ao lado do status.
11. **Por conta.** Cada conta com receitas, despesas e saldo. Conta arquivada só aparece se teve movimento no mês. Cada cartão com
    a fatura do mês, a situação dela e o que já está nas faturas seguintes. A fatura paga entra nas despesas da conta que paga: a
    linha do cartão é detalhe e não soma de novo.
12. **Investimentos.** Em todo mês: aportes e resgates do mês, das operações. Em mês passado: valor aplicado até o fim do mês,
    calculado das operações, com o rótulo "histórico". Carteira, ganho e divisão por classe são sempre a posição de hoje, com o rótulo
    "hoje": não existe histórico de preço (`market_quotes` guarda só a última cotação).
13. **Proventos.** Recebidos no mês, anunciados com pagamento no mês, anunciados depois dele e total dos 12 meses até o escolhido.
    Estimativa pelo histórico aparece à parte, com esse nome, do mês atual em diante. Só para família em real, como a tela de proventos.
14. **Reserva e patrimônio.** Sempre a posição de hoje; fora do mês atual, o título diz "hoje".

No computador, os blocos 7 a 9 e o 13 dividem duas colunas: à esquerda, Evolução e Por categoria; à direita, Próximos
vencimentos, Lançamentos do mês e Reserva e patrimônio. No celular seguem a ordem da lista.

## Regras da conta

- **Mesmos números.** Os números do mês são `summarizeMonth` sobre `buildMonthEntries`, com as previsões, faturas, parcelas, metas
  e rendas, como em `/app/lancamentos` e no relatório de Resumo.
- **Aporte não é despesa, e resgate não é receita (ADR-0027).** Aporte, resgate e parcela de meta têm números próprios, com a mesma
  definição em todas as telas. O saldo das contas não muda.
- **Transferência** não é receita nem despesa. Só mexe no saldo das duas contas.
- **Cartão.** Compra vira despesa quando a fatura é paga. Fatura aberta é despesa prevista, na data de vencimento.
- **Moeda estrangeira.** `amount` já está na moeda principal, com a cotação congelada no lançamento. O saldo de mês passado converte
  o saldo na moeda da conta pela cotação do último dia do mês (ou a última anterior). Sem cotação, a conta fica fora da soma e a tela
  diz qual moeda faltou.
- **Conta arquivada** fica fora do saldo total, como hoje em Contas.
- **Provento não é receita.** A tabela `dividends` não gera lançamento, e a tela diz que não entra nas receitas do mês.
- **Previsto em aberto de mês passado** não entra na projeção de mês futuro: a projeção soma do mês atual em diante.

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
