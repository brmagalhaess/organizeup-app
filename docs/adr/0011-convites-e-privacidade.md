# ADR-0011 — Convites, aceite legal, exportação e exclusão

Status: aceito (2026-10-30)

## Decisão

- **Convite por link, sem e-mail.** Ainda não há SMTP. O responsável informa e-mail e papel (adulto ou só leitura),
  copia o link e envia por mensagem. O link vale 7 dias e só é aceito por quem entrar com o e-mail convidado.
- **Verificação de e-mail desligada no convite** (`requireEmailVerificationOnInvitation: false`). O Better Auth a
  exige por padrão quando o gerador de id é próprio, com medo de id previsível. O nosso é UUID v4 de
  `crypto.randomUUID`, então o id funciona como segredo. Quem tiver o link e souber o e-mail entra. Religar quando
  houver SMTP.
- **Sem link na `people`.** Quem aceita o convite vira membro, mas não entra sozinho em "Pessoas da família", que
  serve a planos e pode ter gente sem login.
- **Aceite em `legal_acceptance`** (usuário, versão, data), recusado no servidor se não vier no cadastro. Tabela
  própria em vez de coluna em `user`: guarda o histórico de versões e não obriga a web a esperar a migração.
- **Exportação** em JSON, só para o responsável, em `exportHousehold`. Um teste falha se existir tabela com
  `household_id` fora da lista.
- **Exclusão da conta** com a senha. Família só da pessoa é apagada em cascata. Família com mais gente bloqueia:
  é preciso remover o acesso das outras pessoas antes.

## Ainda falta

- Contato do encarregado e identificação do controlador nos textos legais, exigidos pelo art. 41 da LGPD antes de
  abrir ao público. Os textos também precisam de revisão jurídica.
- Transferir a responsabilidade por uma família, e apagar só a família sem apagar a conta.
- Confirmação em dois fatores para exportar, apagar e convidar (Fase 7).
- Recuperar senha, que depende do SMTP.
