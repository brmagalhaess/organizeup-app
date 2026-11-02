# ADR-0011 — Convites, aceite legal, exportação e exclusão

Status: aceito (2026-10-30)

## Decisão

- **Convite por e-mail e por link.** O responsável informa e-mail e papel (adulto ou só leitura). O sistema envia
  o link pela Brevo, e o responsável também pode copiá-lo e mandar por mensagem. O link vale 7 dias e só é aceito
  por quem entrar com o e-mail convidado.
- **Verificação de e-mail desligada no convite** (`requireEmailVerificationOnInvitation: false`). O Better Auth a
  exige por padrão quando o gerador de id é próprio, com medo de id previsível. O nosso é UUID v4 de
  `crypto.randomUUID`, então o id funciona como segredo. Quem tiver o link e souber o e-mail entra. Continua
  desligada mesmo com o envio de e-mail: confirmar o e-mail não é obrigatório para entrar, quem chega pelo convite
  aceita logo depois de criar a conta, e as contas antigas nunca receberam confirmação. Ligar agora travaria esses
  aceites.
- **Sem link na `people`.** Quem aceita o convite vira membro, mas não entra sozinho em "Pessoas da família", que
  serve a planos e pode ter gente sem login.
- **Aceite em `legal_acceptance`** (usuário, versão, data), recusado no servidor se não vier no cadastro. Tabela
  própria em vez de coluna em `user`: guarda o histórico de versões e não obriga a web a esperar a migração.
- **Exportação** em JSON, só para o responsável, em `exportHousehold`. Um teste falha se existir tabela com
  `household_id` fora da lista.
- **Exclusão da conta** com a senha. Família só da pessoa é apagada em cascata. Família com mais gente bloqueia:
  é preciso remover o acesso das outras pessoas antes.

## Confirmação de e-mail (2026-11-02)

Pedido do fundador: o painel dizia "não verificado", e a pessoa não tinha como resolver. Continua opcional: nada exige
e-mail confirmado para entrar, usar o sistema ou aceitar convite. Só muda quem não confirmou ter como confirmar.

- **Reenvio por server action, sem endereço vindo do cliente.** A conta e o e-mail saem da sessão. A rota pública
  `/send-verification-email` foi fechada em `disabledPaths`: ela aceita qualquer e-mail, sem sessão e fora do limite.
- **Espera a Brevo.** O cadastro segue em segundo plano, mas aqui a tela só diz "enviado" se saiu. Por isso o token
  é criado direto, com `createEmailVerificationToken`, e não por `auth.api`, que passa pelo envio em segundo plano.
- **Limite em `verification`, sem migração.** 1 por minuto e 5 por hora, por conta, somando pessoa e admin. O limitador
  de `lib/rate-limit.ts` fica na memória de um processo e o do Better Auth é por IP. Uma linha por envio, com trava
  `pg_advisory_xact_lock` por conta, vale entre instâncias e depois de um deploy. O Better Auth apaga linhas vencidas.
  Envio que falhou devolve a vaga. O e-mail do cadastro não conta.
- **Volta do link decidida antes do Better Auth**, em `verifyEmailLanding`. Sozinho, ele trata link repetido como
  sucesso, responde JSON quando falta `token` e, em conta bloqueada, confirma e só depois falha ao abrir a sessão. O
  gancho confere o token, ignora o `callbackURL` da URL, que fica sempre `/confirmar-email`, e leva conta bloqueada a
  `/conta-bloqueada` sem gravar nada. Na manutenção o link não grava, e o mesmo link vale depois.
- **Link repetido não abre sessão.** O token é um JWT sem registro: vale até vencer, mas depois da primeira vez não faz
  nada, e a tela diz que o e-mail já está confirmado. A primeira abertura continua entrando na conta, como antes.
- **O endereço não decide sozinho.** `/confirmar-email` pode ser digitado: com sessão de e-mail não confirmado nunca
  mostra sucesso, e sem `estado` nem `error` mostra link inválido.
- **Fechar o aviso** vale até a meia-noite, como os outros avisos do painel. Configurações mostra sempre.

## Ainda falta

- Contato do encarregado e identificação do controlador nos textos legais, exigidos pelo art. 41 da LGPD antes de
  abrir ao público. Os textos também precisam de revisão jurídica.
- Transferir a responsabilidade por uma família, e apagar só a família sem apagar a conta.
- Confirmação em dois fatores para exportar, apagar e convidar (Fase 7).
