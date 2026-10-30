# Bootstrap — como a produção foi montada

Referência para recriar o ambiente. Nada aqui é feito por agentes.

## GitHub

- Repositório privado `brmagalhaess/organizeup-v3` (o nome `organizeup` pertence a um projeto antigo).
- `.github/CODEOWNERS` aponta para `@brmagalhaess`.
- Conta-máquina dos agentes (Fase 1): `organizeup-bot`, colaboradora com permissão **Write**, PAT guardado
  só no Paperclip.
- Rulesets e GitHub Actions dependem de resolver a cobrança da conta e de ter GitHub Pro.

## Dokploy (`dokploy.home.crowntech.com.br`, projeto `OrganizeUp v3`)

1. **Database → PostgreSQL** `ou3-db`: banco `organizeup`, imagem `pgvector/pgvector:pg17`, sem porta
   externa. Não use `pg18`: ele não inicia com o volume em `/var/lib/postgresql/data`.
2. **Applications** `ou3-worker` e `ou3-web`: provider GitHub (conta "Git Bruno"), repositório
   `organizeup-v3`, branch `main`, Autodeploy ligado, build **Dockerfile**, `Docker Build Stage` = `worker`
   e `web`.
3. **Variáveis**: o arquivo local `.env.dokploy` (fora do Git) traz os blocos de cada serviço.
   - Worker: `MIGRATION_DATABASE_URL` (Internal Connection URL do `ou3-db`), `DATABASE_URL`,
     `OU_APP_DB_PASSWORD`, `OU_WORKER_DB_PASSWORD`, `OU_ADMIN_DB_PASSWORD`.
   - Web: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `OPS_TOKEN_HASHES`.
4. **Domínios da web**: `organizeup.home.crowntech.com.br` (HTTPS, Let's Encrypt) e `organizeup.com.br`
   (preparado, sem HTTPS, ver `cutover-dominio.md`).
5. **Ordem do primeiro deploy**: `ou3-db`, depois `ou3-worker` (cria tabelas, papéis e filas), depois `ou3-web`.
6. **Backups**: Database → Backups com destino S3 (ainda sem destino configurado; pendente antes da Fase 2).
