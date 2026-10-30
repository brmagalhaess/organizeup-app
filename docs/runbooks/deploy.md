# Deploy

Painel: https://dokploy.home.crowntech.com.br, projeto **OrganizeUp v3** (`ou3-db`, `ou3-worker`, `ou3-web`).
Produção: https://organizeup.home.crowntech.com.br

Automático: push em `main` → o Dokploy recebe o webhook do GitHub ("Git Bruno") e constrói `ou3-worker` e
`ou3-web` no servidor. Como o GitHub Actions está sem execução, rode `pnpm check` antes de enviar.

Ordem quando houver migração nova: o worker aplica as migrações ao iniciar, e a web pode subir um pouco
antes dele. Migrações são aditivas, então o código antigo continua funcionando nesse intervalo. Se a
mudança da web depender da migração, faça o deploy do worker primeiro e o da web depois, pelo painel.

Conferir:

```bash
curl -s https://organizeup.home.crowntech.com.br/api/health
curl -s -H "Authorization: Bearer <token-ops>" https://organizeup.home.crowntech.com.br/api/ops/deployments
```

`schemaVersion` deve mostrar a última migração. `commit` aparece como `dev`: o SHA implantado está na aba
Deployments de cada serviço.

Falhou? Veja a aba Logs do serviço e siga `rollback.md`. A fila de builds é compartilhada com os outros
projetos; um deploy pode demorar a aparecer em Deployments enquanto outro projeto constrói.
