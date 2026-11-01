# ADR-0008 — Calendário

Status: aceito (2026-10-30)

## Decisão

- **O calendário não guarda vencimentos.** Ele lê lançamentos, previsões, parcelas e faturas pelo mesmo
  `buildMonthEntries` do fluxo do mês, então os dois nunca discordam. A única tabela nova é
  `calendar_events`, para compromissos sem dinheiro. Evento anual, como aniversário, repete na mesma data a
  partir do ano em que foi criado.
- **Fechamento de fatura** aparece como aviso em cada cartão ativo, sem valor.
- **Saldo previsto por dia** (`projectDailyBalance`): saldo atual das contas ativas mais tudo que está em
  aberto até aquele dia. O que venceu e não foi pago conta como saindo hoje, incluindo o mês anterior.
  Mês passado não tem previsão, e o cálculo para em 24 meses à frente.
- **Pagar pelo dia** usa o mesmo `confirmEntry` das outras telas.
- **Semana começa no domingo**, como nos calendários brasileiros.
- **Cor nunca sozinha**: na grade do computador cada tipo tem seu ícone; no celular as marcas são pontos.
  Nos dois casos, o painel do dia, ao lado ou abaixo da grade, lista cada item com ícone, rótulo e ações.
- **Tipos de item** (`calendarItemType` em `packages/agents`): conta, receita, cartão, dívida, meta, viagem e
  evento. O previsto diz a origem em `source`; o que já foi pago diz pela categoria do sistema; viagem é o
  evento ligado a `trips.calendar_event_id`. O filtro por tipo roda no navegador, sobre o mês já carregado.

## Fora do escopo por enquanto

Horário, lembrete por e-mail ou notificação, editar compromisso e sincronizar com Google Agenda. A previsão
não inclui compras de cartão de faturas ainda inexistentes nem gastos não lançados, e conta só contas ativas.
