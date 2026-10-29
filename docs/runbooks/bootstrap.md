# Bootstrap — GitHub e Dokploy (feito uma vez, pelo fundador)

Ordem: GitHub → GHCR → Dokploy → primeiro deploy. Nada aqui é feito por agentes.

## 1. GitHub

1. Assine **GitHub Pro** (ou crie uma organização com plano Team). Sem isso, rulesets e CODEOWNERS
   não valem em repositório privado.
2. Repositório privado: `brmagalhaess/organizeup-v3` (o nome `organizeup` já pertence a um projeto antigo).
3. `.github/CODEOWNERS` já aponta para `@brmagalhaess`.
4. **Settings → Actions → General → Workflow permissions**: "Read repository contents" (padrão
   read-only para `GITHUB_TOKEN`).
5. **Settings → Rules → Rulesets → New branch ruleset** para `main`:
   - Restrict deletions; Block force pushes.
   - Require a pull request: aprovações = 0, **Require review from Code Owners**,
     Dismiss stale approvals, Require approval of the most recent push.
   - Require status checks: `checks`, `image-e2e`, `risk`.
   - Bypass list: vazia (nem o bot).
6. **Settings → Environments → New environment `production`**:
   - Deployment branches: somente `main`.
   - Secret `DOKPLOY_API_KEY`.
   - Variables `DOKPLOY_URL` (ex.: `https://dokploy.seudominio`), `DOKPLOY_WEB_APP_ID`,
     `DOKPLOY_WORKER_APP_ID`, `APP_URL` (ex.: `https://app.organizeup.com.br`).
7. **Settings → Variables (repositório)**: `FOUNDER_LOGIN` = seu login.
8. Conta-máquina dos agentes (Fase 1): crie `organizeup-bot`, convide como colaboradora com permissão
   **Write**, gere um PAT (classic `repo`, expiração ≤ 90 dias) e guarde-o só no Paperclip.

## 2. GHCR (imagens)

Depois do primeiro CI verde em `main`, existirão `ghcr.io/<owner>/organizeup-web` e
`ghcr.io/<owner>/organizeup-worker`. Crie um PAT seu com **somente `read:packages`** para o Dokploy
puxar as imagens privadas.

## 3. Dokploy (projeto `organizeup`)

1. **Database → PostgreSQL**: imagem `pgvector/pgvector:pg17`, sem porta externa. Anote a URL interna
   e a senha do usuário dono.
2. Gere segredos (rode localmente, um por variável):
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```
3. **Application `organizeup-worker`** → Provider **Docker**: imagem
   `ghcr.io/<owner>/organizeup-worker:main`, registry `ghcr.io`, usuário = seu login, senha = PAT
   `read:packages`. Auto Deploy **desligado**. Environment:
   ```
   MIGRATION_DATABASE_URL=postgres://<dono>:<senha>@<host-interno>:5432/<banco>
   DATABASE_URL=postgres://ou_worker:<OU_WORKER_DB_PASSWORD>@<host-interno>:5432/<banco>
   OU_APP_DB_PASSWORD=<segredo>
   OU_WORKER_DB_PASSWORD=<segredo>
   OU_ADMIN_DB_PASSWORD=<segredo>
   ```
4. **Application `organizeup-web`** → Provider **Docker**: `ghcr.io/<owner>/organizeup-web:main`,
   mesmas credenciais de registry, Auto Deploy **desligado**, porta 3000, domínio com HTTPS.
   Environment:
   ```
   DATABASE_URL=postgres://ou_app:<OU_APP_DB_PASSWORD>@<host-interno>:5432/<banco>
   BETTER_AUTH_SECRET=<segredo>
   BETTER_AUTH_URL=https://<domínio da web>
   OPS_TOKEN_HASHES=<sha256 dos tokens dos agentes, separados por vírgula>
   ```
   Advanced → Swarm: Health check
   `CMD curl -fsS http://127.0.0.1:3000/api/health?probe=live`, Update Config com
   `FailureAction: rollback`.
5. **Backups**: Database → Backups → destino S3 (Cloudflare R2), diário. Teste o restore
   (`restore.md`) antes da Fase 2.
6. **Hardening**: porta 3000 do painel do Dokploy fechada para a internet, `ufw-docker`,
   Postgres sem porta externa.
7. Copie os IDs das duas Applications e uma API key do Dokploy para o Environment `production` do GitHub.

## 4. Primeiro deploy

Faça merge de qualquer PR em `main` (ou re-rode o workflow `ci`). O workflow `deploy` sobe o worker
(migrações), depois a web, e só passa quando `GET $APP_URL/api/health` responde o commit do merge.
Crie sua conta pela tela `/cadastro`.
