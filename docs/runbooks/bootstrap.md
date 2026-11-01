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
     (opcional; `false` desliga os agentes diários do produto e a coleta de cotações sem novo deploy,
     ADR-0015), `BRAPI_TOKEN` (chave da brapi.dev, só no `ou3-worker`; vazia, consulta só PETR4, VALE3, MGLU3 e
     ITUB4, loga um aviso e segue), `BRAPI_MAX_CALLS_PER_DAY` (opcional; padrão 400, soma todas as rodadas do
     dia: passar do limite do plano encerra a licença, ADR-0017). Antes de colocar o token em produção,
     confirme o plano: o grátis é descrito pela brapi para validar a integração.
   - Web: `DATABASE_URL` (ou_app), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `OPS_TOKEN_HASHES`,
     `ADMIN_USER_IDS` (ids da tabela `user` que podem abrir `/admin`, separados por vírgula; cada um copia o
     seu em Configurações › "ID da conta"), `ADMIN_DATABASE_URL` (conexão `ou_admin`, usada só pelo painel
     `/admin`, com leitura somente leitura e ações registradas), `ADMIN_DATABASE_POOL_MAX` (opcional; padrão 2).
     `BREVO_API_KEY` (chave da API v3 da Brevo; sem ela nenhum e-mail sai e a web loga `email_disabled`),
     `EMAIL_FROM_NAME` e `EMAIL_FROM_ADDRESS` (opcionais; o padrão é
     `OrganizeUp <notificacoes@organizeup.com.br>`, remetente já verificado na Brevo).
     `ADMIN_EMAILS` **não** vai para produção: só desenvolvimento e e2e, porque um e-mail sem conta pode
     ser tomado por quem se cadastrar com ele (ADR-0016).
     `ANTHROPIC_API_KEY` (chave da API da Anthropic, no `ou3-web` e no `ou3-worker`, nunca com `NEXT_PUBLIC`; vazia, o assistente
     aparece como indisponível e o resto segue igual), `ANTHROPIC_WORKSPACE_ID` (`wrkspc_...`, obrigatório quando a
     chave não pertence a um workspace; o botão **Testar a IA** em `/admin/sistema` avisa), `AI_MONTHLY_BUDGET_USD` (opcional; padrão 50, teto do
     serviço no mês) e `AI_FAMILY_DAILY_TOKENS` (opcional; padrão 200000, teto por família e dia). Ao bater o teto
     mensal o assistente para sozinho e o painel avisa. Para desligar na hora, use `/admin/controles` (ADR-0018).
   - E2E (fora do Dokploy): `assistente.spec.ts` precisa de `E2E_ASSISTANT=1` no Playwright e do servidor em
     `next dev` (com `NODE_ENV=production` o modelo falso é ignorado), com `ANTHROPIC_API_KEY` qualquer e
     `AI_TEST_BASE_URL=http://127.0.0.1:3199`, depois de `node apps/web/e2e/fake-model.mjs 3199`. Rode com
     `--workers=1`; para vários specs juntos, suba o servidor com `AUTH_RATE_LIMIT=disabled`.
     `E2E_ADMIN_EMAIL` liga o spec `admin.spec.ts`; o servidor de teste sobe com
     `ADMIN_EMAILS` igual a esse valor. `EMAIL_CAPTURE_FILE` liga `recuperar-senha.spec.ts`: o servidor
     grava os e-mails nesse arquivo em vez de enviar. Como `NODE_ENV=production` desliga a captura, esse
     spec roda contra `next dev`, com a mesma variável no servidor e no Playwright.
4. **Domínios da web**: `organizeup.crowntech.com.br` (HTTPS, Let's Encrypt) e `organizeup.com.br`
   (preparado, sem HTTPS, ver `cutover-dominio.md`).
5. **Ordem do primeiro deploy**: `ou3-db`, depois `ou3-worker` (cria tabelas, papéis e filas), depois `ou3-web`.
6. **Backups**: Database → Backups com destino S3. Ativo no Cloudflare R2; ver [backup.md](backup.md).
