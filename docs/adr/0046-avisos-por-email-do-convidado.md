# ADR-0046 — Avisos por e-mail de quem é convidado

Status: aceito (2026-11-17)

## Contexto

Os lembretes por e-mail (ADR-0039) saem para todo login com e-mail confirmado, e cada pessoa escolhe o que
recebe em Notificações. Na prática só o responsável recebia: a convidada entrou pelo link de convite e nunca
confirmou o e-mail, e a rodada só manda para e-mail confirmado. O fundador pediu, em Pessoas, a opção de ligar
ou desligar os avisos de cada convidado, e que o envio funcione de fato quando ligado.

## Decisão

- **Em Pessoas → Quem acessa**, o responsável vê, em cada login que não é ele, a chave "Avisos por e-mail".
  É a mesma chave geral que a pessoa vê em Notificações (`email_reminders.enabled`): quem mudar por último
  vale. O resto da escolha (contas, receitas, gastos, antecedência) continua só da pessoa.
- **E-mail sem confirmar continua sem aviso.** Os avisos levam valores e nomes de contas; mandar para um
  endereço que ninguém provou ser seu seria vazar dado. Com a chave ligada e o e-mail sem confirmar, a tela diz
  isso e oferece "Enviar confirmação", que manda o link de confirmação para o e-mail **da conta** (nunca um
  endereço digitado), com o mesmo limite de pedidos do reenvio da própria pessoa. Fica na auditoria.
- **Migração 0057**, só políticas novas em `email_reminders`: o responsável (`app_role() = 'owner'`) lê e grava
  linhas da própria família, e só de quem é membro dela (`household_member`). Quem não é responsável segue
  vendo e mudando só a própria linha. `loadReminderPrefs` passa a filtrar pela pessoa logada, porque o
  responsável agora enxerga mais de uma linha.
- Antes de a migração chegar, a tela mostra os convidados no padrão (ligado) e a gravação responde que não deu
  certo; nada quebra.

## Consequências

- A exportação feita pelo responsável passa a levar as linhas de lembrete dos outros membros (só as escolhas e
  as datas do último aviso, sem valores).
- Se o convidado nunca abrir o link de confirmação, continua sem aviso; a tela deixa isso claro.
