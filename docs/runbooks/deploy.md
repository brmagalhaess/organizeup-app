# Deploy

Painel: https://dokploy.home.crowntech.com.br, projeto **OrganizeUp v3** (`ou3-db`, `ou3-worker`, `ou3-web`).
Produção: https://organizeup.crowntech.com.br

Automático: push em `main` → o Dokploy recebe o webhook do GitHub ("Git Bruno") e constrói `ou3-worker` e
`ou3-web` no servidor. Como o GitHub Actions está sem execução, rode `pnpm check` antes de enviar.

Ordem quando houver migração nova: o worker aplica as migrações ao iniciar, e a web pode subir um pouco
antes dele. Migrações são aditivas, então o código antigo continua funcionando nesse intervalo. Se a
mudança da web depender da migração, faça o deploy do worker primeiro e o da web depois, pelo painel.

Caso especial: quando a versão adiciona uma coluna ou tabela que o **layout** da web lê em toda página (por
exemplo, o aviso de cadastro complementar e a contagem de sugestões), ou o worker sobe antes, ou a web precisa
tolerar os erros `42703` (coluna não existe) e `42P01` (tabela não existe) até ele subir, tratando-os como
"sem aviso". O código do layout já faz isso; não remova essa tolerância.

Conferir:

```bash
curl -s https://organizeup.crowntech.com.br/api/health
curl -s -H "Authorization: Bearer <token-ops>" https://organizeup.crowntech.com.br/api/ops/deployments
```

`schemaVersion` deve mostrar a última migração. `commit` mostra o SHA real publicado (desde `c9f23d0`); deve
ser igual ao commit do merge. Se aparecer `dev`, a imagem foi construída sem o arquivo `COMMIT`: veja a aba
Deployments do serviço. Os agentes diários do produto rodam às 04:00; `/api/ops/context` mostra em
`agentRuns` se rodaram depois do deploy.

Falhou? Veja a aba Logs do serviço e siga `rollback.md`. A fila de builds é compartilhada com os outros
projetos; um deploy pode demorar a aparecer em Deployments enquanto outro projeto constrói.
