# Backup do banco

Backup diário do `ou3-db`, feito pelo Dokploy e guardado no Cloudflare R2.

| Item           | Valor                                                             |
| -------------- | ----------------------------------------------------------------- |
| Onde configura | Dokploy → projeto OrganizeUp v3 → `ou3-db` → aba Backups          |
| Horário        | `0 6 * * *` em UTC, ou 03:00 em Brasília                          |
| Retenção       | 30 cópias mais recentes                                           |
| Destino        | S3 Destination `cloudflare-r2-backups`                            |
| Bucket         | `organizeup-backups`, privado, conta Cloudflare do fundador       |
| Pasta real     | `organizeup-v3-ou3db-vgj8dl/organizeup/`                          |
| Arquivo        | `AAAA-MM-DDTHH-MM-SS-mmmZ.sql.gz`                                 |
| Chave          | `organizeup-backups-dokploy`: Object Read & Write só nesse bucket |
| Custo          | Grátis até 10 GB; depois US$ 0,015 por GB ao mês                  |

O Dokploy põe o nome interno do banco antes do prefixo, por isso a pasta real não é só `organizeup/`.
"Backup Done" no Dokploy não basta: confira o arquivo no bucket.

## Conferir se está funcionando

1. `ou3-db` → Backups → ícone de lista: a última execução deve estar verde e ter menos de 24 h.
2. Cloudflare → R2 → `organizeup-backups` → pasta acima: o arquivo do dia deve existir, com tamanho
   parecido com o da véspera.

Faça isso toda semana, porque **falha de backup ainda não gera alerta**.

## Trocar a chave

Cloudflare → R2 → Manage API Tokens → `organizeup-backups-dokploy` → ··· → Roll. Cole **Access Key ID** e
**Secret Access Key** em Dokploy → S3 Destinations. O **Token value** é outro código e não serve aqui: colar
ele causa `SignatureDoesNotMatch` (403). A tela mostra o segredo uma vez só, então confirme um backup
manual antes de sair dela.

## Testar a restauração (todo mês)

Nunca restaure em cima de `ou3-db` para testar. Use um banco temporário:

1. Projeto → Create Service → Database → PostgreSQL. Nome `ou3-teste-restauracao`, banco `restauracao`,
   imagem `pgvector/pgvector:pg17`, senha gerada pelo botão. Clique em Deploy.
2. Nesse serviço: Backups → Restore Backup → destino `cloudflare-r2-backups`, busque
   `organizeup-v3-ou3db-vgj8dl/organizeup/`, escolha o arquivo, banco `restauracao`.
3. Open Terminal e conte as linhas, sem abrir dados pessoais:
   ```bash
   psql -U postgres -d restauracao -xc "select (select max(version) from schema_migrations) migracao, (select count(*) from household) familias, (select count(*) from \"user\") usuarios, (select count(*) from people) pessoas, (select count(*) from accounts) contas, (select count(*) from transactions) lancamentos"
   ```
4. A migração deve ser igual à de `/api/health` em produção, e as contagens devem fazer sentido.
5. **Apague o serviço temporário**: ele contém dados pessoais de produção.
6. Registre abaixo.

| Data       | Arquivo                         | Resultado                                                              |
| ---------- | ------------------------------- | ---------------------------------------------------------------------- |
| 2026-10-30 | 2026-10-30T15-48-46-465Z.sql.gz | Restaurou em banco temporário: migração 0008, 1 família, 17 categorias |

## Restaurar em produção

Veja [restore.md](restore.md). No Dokploy, Restore Backup **sobrescreve o banco escolhido**: confira duas
vezes o serviço aberto. Perde-se o que foi gravado depois da última cópia, no máximo cerca de 24 horas.

## Limites conhecidos

- As cópias não têm cifragem própria: dependem do bucket privado e da proteção padrão do Cloudflare. Elas
  contêm dados pessoais e hashes de senha. Acrescente cifragem antes de abrir para outras pessoas.
- Sem alerta de falha. Configure em Dokploy → Notifications.
- O serviço temporário sai do painel ao ser excluído, mas não foi confirmado se o volume dele some do disco.
