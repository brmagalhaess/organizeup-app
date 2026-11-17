# ADR-0043 — Pagamento de fatura em mais de uma vez (etapa 1: juntar e desligar; etapa 2: automático)

Status: aceito (2026-11-16)

## Contexto

A fatura do cartão tinha um pagamento só (ADR-0038): o débito do banco perto do vencimento dá baixa, e o que
faltou vai para a fatura seguinte como "Saldo da fatura". Na prática a fatura é paga em partes (um
adiantamento, um pedaço dias antes do vencimento, o resto no dia), e a família às vezes marca a fatura como
paga antes de o banco trazer os débitos. Cada débito além do primeiro entrava como "Outras despesas", somando
de novo o que a fatura já contava, e o "Saldo da fatura" virava dívida que não existe.

Uma primeira versão, toda automática, foi descartada antes de entrar: uma revisão adversária confirmou 24
defeitos. A causa comum era ajustar valores aos poucos a cada débito (não dá para desfazer, e duas rodadas ao
mesmo tempo descontam em dobro) e adivinhar pelo texto e pela data o que nenhuma regra sabe: se o débito é o
pagamento marcado à mão aparecendo no banco ou um pagamento a mais, de qual fatura é um adiantamento, e de
qual cartão é o débito quando dois saem da mesma conta. O fundador escolheu fazer em etapas.

## Decisão (etapa 1)

- **Nada roda sozinho.** A importação do banco continua como estava. Na tela de cartões, cada fatura mostra
  os débitos do banco que parecem ser dela, e a família junta com um clique ("Juntar") e desfaz com outro
  ("Desligar").
- **Modelo.** O pagamento principal continua em `card_statement_payments` (uma linha por fatura, como
  antes). Os outros débitos ligados à mesma fatura ficam em `card_statement_parts` (migração 0056), um
  lançamento por linha. O débito continua sendo um lançamento visível, com o valor, o dia e a conta do banco,
  e vai para a categoria "Cartão de crédito".
- **O saldo levado é sempre refeito** (`refreshCarry`): total das compras menos o pagamento principal e as
  partes ligadas (`statementCarry`); sem pagamento, nenhum saldo. Nunca é somado nem diminuído, então
  desligar, apagar e repetir dão o mesmo resultado. Quando o saldo de uma fatura muda, a seguinte ganhou ou
  perdeu uma compra, e o saldo dela é refeito em seguida, até uma fatura em que nada muda. Vale nos dois
  sentidos: o saldo que some não deixa dívida fantasma adiante, e o que volta não se perde dentro de uma
  fatura já paga.
- **Fatura marcada à mão.** O débito do banco toma o lugar do que foi marcado (`joinReplaces`): o valor
  marcado cai, e o total pago não muda. O quanto foi tomado fica guardado na ligação e volta se ela for
  desfeita. Quando o banco cobre tudo, o débito passa a ser o pagamento e o marcado sai; daí em diante as
  partes já ligadas valem como pagamento a mais, sem nada a devolver (`forgetReplaced`), e o mesmo vale
  quando uma parte é promovida a pagamento. O débito igual ao saldo levado é tratado como o complemento que
  faltava. Na dúvida quem decide é a família: a tela pergunta
  se é "o pagamento que marquei à mão" ou "um pagamento a mais".
- **Fatura sem pagamento.** Só recebe débito depois de fechar: antes disso ainda chegam compras, e marcá-la
  como paga travaria o mês. O débito juntado vira o pagamento; se for menos que o total, o resto vai para a
  seguinte, e as outras partes, juntadas depois, diminuem esse saldo.
- **O que a tela sugere** (`loadStatementPayments`, só leitura): débito do banco, numa conta que paga o
  cartão (a que ele indica ou a do mesmo banco na conexão), dos últimos quatro meses, ainda como despesa
  comum e sem outro vínculo (renda, parcela de dívida, meta, aporte), que cai no ciclo da fatura
  (`statementPaidOn`; pago até dez dias depois de um vencimento, aparece na fatura que venceu e na seguinte),
  não passa de uma vez e meia o que há para acertar e parece pagamento de fatura pelo texto (`looksLikeCardBill`) ou tem exatamente o valor
  que falta. Só para fatura com o que acertar: marcada à mão, com saldo levado, ou fechada sem pagamento. A
  regra do texto é larga de propósito ("FATURA ENEL" aparece), porque quem decide é a pessoa. O servidor só
  aceita juntar o que ele mesmo sugeriria.
- **Fatura paga do jeito antigo fica como está**, enquanto ninguém mexer no que ela pagou: juntar um débito
  que só toma o lugar do marcado à mão não muda o que foi pago, e nada é recalculado. O saldo só é refeito
  quando o que foi pago muda (pagamento a mais que entra ou sai, pagamento apagado, valor editado) ou quando
  a fatura anterior passa a levar outro saldo para ela.
- **Desligar** vale para débito do banco recente (a mesma janela de quatro meses da sugestão): desligado, ele
  volta a aparecer como sugestão. Volta para a categoria que tinha; sem categoria conhecida, vai para "Outras
  despesas" marcado para revisar. Desligar o pagamento principal reabre a fatura, ou passa a vez para a parte
  mais antiga.
- **Apagar, desfazer e editar.** `deleteEntry` e `undoImport` devolvem antes o que o débito tinha tomado do
  marcado à mão; depois de apagar, a fatura que perdeu o pagamento principal e ainda tem partes ganha a mais
  antiga como pagamento, e o saldo é refeito em cadeia. O lançamento que `undoImport` devolve a previsão
  deixa de pagar a fatura. Editar o valor de um pagamento ou de uma parte refaz o saldo; virou previsão ou
  receita, a ligação sai.
- **Trava.** Juntar, desligar, apagar e desfazer começam com `lockFamilyImport`, antes de ler as ligações.
  A edição de um lançamento ligado toma a trava antes de gravar.
- **Banco atrasado.** Sem a 0056, a tela não mostra partes, e juntar o segundo débito responde que ainda não
  dá; o resto se comporta como hoje.

## Consequências

- O que a família não juntar continua como hoje: despesa comum, contada além da fatura.
- Adiantamento antes do fechamento só pode ser juntado depois que a fatura fecha.
- Débito pulado na importação por ser gêmeo de um pagamento marcado à mão (mesmo valor, até três dias) não
  vira lançamento e não aparece como sugestão.
- Pagamento marcado à mão em moeda estrangeira não é trocado: o débito entra como pagamento a mais.
- Quando o débito toma o lugar do pagamento marcado à mão, o marcado sai de vez: desligar depois reabre a
  fatura, e não traz o marcado de volta. O diálogo avisa.
- Fatura que recebe saldo da anterior tem o próprio saldo refeito pelo total atual das compras: compra que
  entrou nela depois do pagamento passa a contar.
- "PIX no crédito" (dinheiro do cartão que entra na conta) continua como receita: o resultado do mês fecha,
  porque a saída desse dinheiro e a fatura contam como despesa.
- Débito desligado que tinha tomado o lugar de parte de um pagamento marcado à mão pode não voltar como
  sugestão, se passar de uma vez e meia o que restou para acertar.
- Pagar uma fatura em parte (à mão ou pelo banco) passa a refazer o saldo das faturas seguintes que já têm
  pagamento: a dívida que entra nelas não se perde.
- Etapa 2: ver abaixo.

## Etapa 2 — junta sozinho o que não deixa dúvida (2026-11-17)

O fundador pediu que o sistema faça sozinho, sem aprovação: em novembro, dois "Pagamento de fatura" somavam
metade de "Outras despesas", contados além da fatura. Depois de cada sincronização do banco (rodada do
Paperclip e "Atualizar contas"), `autoJoinStatementDebits` junta pelo mesmo caminho do botão "Juntar" o débito
sugerido que passa em tudo isto:

- o texto diz que é fatura de cartão (`saysCardBill`: "pagamento" e "fatura", ou "fatura" e "cartão"; "DEB
  AUT FATURA CLARO" não passa) e não cita outro cartão da casa;
- cabe numa fatura só (entre todos os cartões e meses), e a conta paga um cartão só, arquivado inclusive;
- caiu depois do fechamento da fatura (adiantamento e pagamento atrasado da anterior ficam para a família);
- a família não mexeu nele (`categorySource` "familia": desligou ou escolheu a categoria);
- e, pela situação da fatura: sem pagamento, só o débito que paga a fatura inteira; marcada à mão na mesma
  conta, só o débito que cabe no valor marcado e não é igual ao saldo levado (modo "marcado": o total pago não
  muda); paga pelo banco, só o débito igual ao saldo levado.

O resto continua como sugestão na tela. Desligar desfaz e não volta a ser juntado sozinho. Uma revisão
adversária achou os casos de conta de serviço com "fatura" no texto, fatura de outro banco paga pela mesma
conta, Desligar que não durava e marcado em outra conta; todos viraram regra acima e teste.
