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
3. **Variáveis por serviço**: o arquivo local `.env.dokploy` (fora do Git) traz os blocos de cada serviço.
   Os valores só o fundador cola no Dokploy; nunca entram no repositório. Cada variável tem uma linha de
   explicação em `.env.example`.
   - Worker: `MIGRATION_DATABASE_URL` (Internal Connection URL do `ou3-db`), `DATABASE_URL` (ou_worker),
     `OU_APP_DB_PASSWORD`, `OU_WORKER_DB_PASSWORD`, `OU_ADMIN_DB_PASSWORD`, `DAILY_AGENTS_ENABLED`
     (opcional; `false` desliga os agentes diários do produto sem novo deploy, ADR-0015).
   - Web: `DATABASE_URL` (ou_app), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `OPS_TOKEN_HASHES`,
     `ADMIN_USER_IDS` (ids da tabela `user` que podem abrir `/admin`, separados por vírgula; cada um copia o
     seu em Configurações › "ID da conta"), `ADMIN_DATABASE_URL` (conexão `ou_admin`, usada só pelo painel
     `/admin`, com leitura somente leitura e ações registradas), `ADMIN_DATABASE_POOL_MAX` (opcional; padrão 2).
     `ADMIN_EMAILS` **não** vai para produção: só desenvolvimento e e2e, porque um e-mail sem conta pode
     ser tomado por quem se cadastrar com ele (ADR-0016).
   - E2E (fora do Dokploy): `E2E_ADMIN_EMAIL` liga o spec `admin.spec.ts`; o servidor de teste sobe com
     `ADMIN_EMAILS` igual a esse valor.
4. **Domínios da web**: `organizeup.crowntech.com.br` (HTTPS, Let's Encrypt) e `organizeup.com.br`
   (preparado, sem HTTPS, ver `cutover-dominio.md`).
5. **Ordem do primeiro deploy**: `ou3-db`, depois `ou3-worker` (cria tabelas, papéis e filas), depois `ou3-web`.
6. **Backups**: Database → Backups com destino S3. Ativo no Cloudflare R2; ver [backup.md](backup.md).
