# ADR-0041 — Nome e e-mail na lista de contas do admin

Status: aceito (2026-11-13)

## Contexto

O ADR-0016 deixou o painel do serviço com o mínimo de dados pessoais: a lista de contas (`/admin/usuarios`)
mostrava só um código curto, e nome e e-mail saíam por uma ação registrada ("Ver nome e e-mail"), e só de
responsável de família ou de conta sem família. Para dar suporte, o fundador precisa saber quem é cada conta
olhando a lista, inclusive os membros convidados, e pediu o nome (e o que mais ajudar) no lugar do código.

## Decisão

- **A lista e o detalhe de conta mostram nome e e-mail de todas as contas**, responsável ou membro. O código
  curto continua, ao lado do e-mail, para casar com a auditoria.
- **Abrir a lista e o detalhe continua registrado** em `ops.admin_access` (`usuarios:lista`,
  `usuarios:busca`, `usuario:detalhe`), sem o texto da busca, nome ou e-mail no registro (regra 5).
- **A busca aceita parte do nome**, com duas letras ou mais, além do e-mail exato e do id. Parte do e-mail
  não busca: o painel não serve para listar endereços. Os curingas do `LIKE` valem como letra.
- **Sai o botão "Ver nome e e-mail"** e a função `adminRevealUser`: o que ele mostrava já está na tela.
- **O resto do ADR-0016 continua.** O documento completo segue por ação registrada e só de responsável
  (`adminRevealIdentity`). O detalhe da família segue sem nome nem e-mail das pessoas; o do responsável sai
  por `adminHouseholdOwner`. Nenhum valor nem lançamento aparece no painel.
- **A Política de Privacidade diz isso** ("Quem vê seus dados"), com a versão `2026-11-13.1`.

## Consequências

- Quem tiver acesso ao admin vê o nome e o e-mail de todos os cadastrados de uma vez. O portão continua o
  mesmo (`ADMIN_USER_IDS`, sem 2FA no admin): a segunda etapa no admin fica mais importante.
- O aceite antigo da política não é pedido de novo: a versão nova vale para os próximos aceites.
