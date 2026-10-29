# Rollback

## Caminho preferido: `git revert`

Abra um PR revertendo o merge problemático (`git revert <sha>`). O CI publica uma imagem nova e o
deploy segue o fluxo normal. É o caminho que o agente SRE usa.

## Caminho rápido (humano): reimplantar a imagem anterior

1. Encontre o último SHA saudável (`GET /api/ops/deployments` ou histórico do workflow `deploy`).
2. No Dokploy, Application **web** → Provider → troque a tag `:main` por `:<sha-anterior>` → Deploy.
3. Se o problema envolveu migração, **não** volte o worker para uma imagem mais antiga que o schema:
   migrações são aditivas, então código antigo continua compatível com o schema novo.
4. Depois que o `git revert` estiver em `main`, volte a tag para `:main`.

## Automático

O health check do Swarm (`?probe=live`) com `FailureAction: rollback` reverte containers que não sobem.
Ele não detecta erro de negócio — por isso o `deploy` também confere `/api/health` completo.
