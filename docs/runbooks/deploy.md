# Deploy

Automático: merge em `main` → workflow `ci` (checks, imagem, e2e, publica `:<sha>` e `:main` no GHCR)
→ workflow `deploy` (Environment `production`):

1. `application.deploy` do **worker**: o container novo roda as migrações com a credencial do dono e
   depois inicia o pg-boss como `ou_worker`.
2. Espera 60 s e faz `application.deploy` da **web**.
3. Verifica `GET $APP_URL/api/health` até `status: ok` com o `commit` do merge (até 10 min).

Conferir manualmente:

```bash
curl -s https://<domínio>/api/health
curl -s -H "Authorization: Bearer <token-ops>" https://<domínio>/api/ops/deployments
```

Falhou? Veja os logs das Applications no Dokploy e siga `rollback.md`.
Deploy manual (emergência, sem agentes): no Dokploy, Application → Deploy (worker primeiro).
