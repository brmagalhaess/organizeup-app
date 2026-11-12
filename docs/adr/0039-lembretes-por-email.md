# ADR-0039 — Lembretes por e-mail

Status: aceito (2026-11-11)

## Contexto

O fundador pediu que o sistema avise por e-mail cada coisa que pede atenção: dia de receber proventos, conta
ou fatura para pagar, gasto novo que entrou no cartão ou na conta. Depois pediu que todos os membros da
família com e-mail recebam, e um resumo mensal do plano de aposentadoria. Até aqui o sistema só mandava e-mail
de conta (confirmar, senha, convite), e a Política de Privacidade dizia que dado financeiro não ia em e-mail.

## Decisão

- **Um resumo, e não um e-mail por evento.** Cada login recebe no máximo um resumo do dia e, além dele, um
  e-mail só de gastos novos quando eles chegam depois. Sem nada para avisar, nenhum e-mail sai.
- **Quando o resumo do dia sai** (`buildReminder`, em `packages/domain/src/reminders.ts`): alguma conta vence
  hoje, venceu ontem e segue em aberto, ou acabou de entrar na janela de antecedência (três dias por padrão,
  de zero a sete); ou há renda ou provento para hoje. Aí a lista traz a janela inteira, com as vencidas dos
  últimos dez dias.
- **De onde vêm os dados.** Vencimentos e renda: os mesmos compromissos previstos da tela de Lançamentos
  (`buildMonthEntries`). Proventos: o calendário, só dos ativos que a família tem. Gasto novo: lançamento de
  despesa ou compra de cartão criados depois do último aviso que não foram digitados por quem recebe (os que
  chegam pelo banco, e os digitados por outra pessoa). Saldo de fatura paga em parte não conta.
- **Resumo mensal da aposentadoria.** Uma vez por mês, na primeira rodada do mês: cobertura da renda pela
  carteira, renda desejada, proventos de hoje, quanto falta, ano em que chega no ritmo de hoje e o aporte que
  fecha a conta. Só para quem tem o módulo e um plano com dados.
- **Quem recebe.** Todo login com e-mail confirmado, em cada família de que participa, inclusive quem só lê.
  Pessoa do cadastro sem login não recebe: não há e-mail confirmado dela. Conta bloqueada, família suspensa
  ou com o plano vencido não recebem.
- **Escolha de cada pessoa**, em Notificações: interruptor geral, um por assunto e a antecedência. Tabela
  `email_reminders` (migração 0053), uma linha por login e família, com RLS pelo próprio login: ninguém vê
  nem muda a escolha de outra pessoa, e quem só lê também escolhe. Sem linha, tudo ligado. A linha guarda
  também até onde o aviso foi (dia do resumo, hora dos gastos, mês da aposentadoria). Nada do conteúdo do
  e-mail fica guardado.
- **Roda na web**, porque a chave da Brevo só existe lá. Agente `lembretes`: roda logo depois de `bancos`
  (06:00 e 18:00, pelo Paperclip), para o gasto que acabou de chegar entrar no aviso, e também quando o
  Paperclip acorda o próprio `lembretes`. A rodada fica em `ops.agent_runs` só com contagens, gravada pela
  conexão administrativa. Desligar o agente no painel para todos os envios.
- **Botões "Enviar exemplo"** na tela: mandam os dois e-mails para quem pediu, com o que está por perto, sem
  mexer nas marcas do aviso de verdade.
- **Layout.** Uma moldura só (`emailShell`): faixa escura com a saudação, números em destaque, blocos por
  assunto com data, descrição e valor, botão e rodapé com o caminho para desligar. Tabelas e estilo em linha,
  tema claro fixo, versão em texto. O assunto leva só contagens: nome digitado por alguém aparece apenas
  dentro do e-mail, escapado e cortado em 60 caracteres.

## Liberação em etapas e a Política de Privacidade

A Política publicada dizia "Dados financeiros não vão nesses e-mails". O texto muda neste mesmo PR (versão
2026-11-11.1): os lembretes levam nome da família, descrições, datas e valores, pela Brevo, e cada pessoa
desliga em Notificações. Como quem já tem conta aceitou o texto antigo, a chave `email_reminders_enabled`
nasce **desligada**: só quem administra o serviço recebe e vê a escolha. O fundador liga para todos em
`/admin/cobranca`, com auditoria, depois de avisar as famílias.

## Consequências

- O e-mail passa a levar dado financeiro. Nada disso vai para o log (regra 5): só o nome do modelo e o código
  da falha.
- A Brevo cobra por envio e tem cota diária: dois envios por login por dia no pior caso, mais um por mês.
- Falha de envio não marca o aviso como feito: a rodada seguinte tenta de novo.

## Fora desta etapa

- Aviso na hora, a cada gasto (push ou e-mail imediato).
- Link de desligar sem login, direto do e-mail.
- Lembrete para pessoa do cadastro que não tem login.
- Horário escolhido por pessoa.
