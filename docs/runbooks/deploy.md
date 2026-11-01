# Deploy

Painel: https://dokploy.home.crowntech.com.br, projeto **OrganizeUp v3** (`ou3-db`, `ou3-worker`, `ou3-web`).
Produção: https://organizeup.crowntech.com.br

Automático: push em `main` → o Dokploy recebe o webhook do GitHub ("Git Bruno") e constrói `ou3-worker` e
`ou3-web` no servidor. Como o GitHub Actions está sem execução, rode `pnpm check` antes de enviar.

Ordem quando houver migração nova: o worker aplica as migrações ao iniciar, e a web pode subir um pouco
antes dele. Migrações são aditivas, então o código antigo continua funcionando nesse intervalo. Se a
mudança da web depender da migração, faça o deploy do worker primeiro e o da web depois, pelo painel.

Depois do deploy, a visão geral de `/admin` mostra o que pede atenção: rodada ou agente que faltou até as 06:00,
dicas que não rodaram até as 07:00, teto de IA em 80%, `Testar a IA` que falhou, worker sem a chave da IA, catálogo
de ativos com mais de 2 dias e base do assistente com mais de 12 meses. Em `/admin/agentes` dá para desligar e rodar
cada agente, Mercado e Dicas inclusive. O catálogo da equipe em `apps/web/src/app/admin/agentes/paperclip.ts` é
escrito à mão: mudou horário ou agente em `paperclip/agentes/`, atualize lá também.

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
Deployments do serviço. Os agentes diários do produto são acordados pelo Paperclip entre 03:45 e 04:40, e o worker roda às 05:30 quem faltou; `/api/ops/context` mostra em
`agentRuns` se rodaram depois do deploy.

Falhou? Veja a aba Logs do serviço e siga `rollback.md`. A fila de builds é compartilhada com os outros
projetos; um deploy pode demorar a aparecer em Deployments enquanto outro projeto constrói.
