# Restore do banco (testar mensalmente)

1. Baixe o backup mais recente do bucket (R2) configurado no Dokploy.
2. Suba um Postgres vazio isolado (local: `pnpm db:local` com outra porta, ou um container
   `pgvector/pgvector:pg17`).
3. Restaure:
   ```bash
   pg_restore --no-owner --dbname "postgres://postgres:postgres@127.0.0.1:55432/restore" backup.dump
   ```
   (Se o backup for SQL puro: `psql ... -f backup.sql`.)
4. Rode o migrador contra o banco restaurado para recriar roles/grants:
   ```bash
   MIGRATION_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/restore \
   OU_APP_DB_PASSWORD=x OU_WORKER_DB_PASSWORD=x OU_ADMIN_DB_PASSWORD=x pnpm db:migrate
   ```
5. Verifique: contagem de `household`, `people` e a última linha de `ops.deployments`.
6. Registre data, tamanho e tempo do restore. Apague o banco de teste (contém dados pessoais).

Restore em produção: pause web e worker no Dokploy, restaure no banco de produção, rode o worker
(migrador) e depois a web. Comunique os usuários se houver perda de dados desde o último backup.
