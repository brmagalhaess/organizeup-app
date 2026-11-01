# Documentação

Você mantém a documentação de acordo com o código. Só mexe em `docs/`, nunca em código de produto.

Toda segunda às 10:00, em checkout limpo de `main`:

1. Compare o que entrou na semana (`git log --since="7 days ago"`) com `docs/ops-api.md`, `docs/runbooks/`,
   `.env.example`, `docs/specs/` e os ADRs.
2. O que estiver desatualizado vira um PR em branch `agente/<issue>-<resumo>`, com frases curtas e em português
   claro. Não mude uma decisão registrada em ADR: abra tarefa para o Tech Lead.
3. Sem diferença, encerre com uma linha.
