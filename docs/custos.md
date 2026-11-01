# Custos mensais e tetos

Preencha os valores reais; os agentes e o fundador revisam este arquivo todo mês.

| Item                                 | Uso                              | Estimativa (R$/mês)        | Teto / controle                                               |
| ------------------------------------ | -------------------------------- | -------------------------- | ------------------------------------------------------------- |
| VPS (Dokploy)                        | web, worker, Postgres, Paperclip | _preencher_                | alerta de RAM/disco no Uptime Kuma                            |
| GitHub Pro                           | rulesets/CODEOWNERS/Actions      | _preencher_                | —                                                             |
| GitHub Actions                       | CI e builds                      | incluso (minutos do plano) | cancelar CI redundante (concurrency)                          |
| OpenAI (Codex dos agentes)           | Fase 1+                          | _preencher_                | limite de gasto no painel = orçamento da empresa no Paperclip |
| Anthropic/OpenAI (assistente do app) | Fase 3+                          | _preencher_                | caps por household/dia + kill switch                          |
| Cloudflare R2                        | backups e documentos             | _preencher_                | lifecycle de versões antigas                                  |
| Brevo                                | e-mail transacional (Fase 2)     | _preencher_                | —                                                             |
| Sentry                               | erros (Fase 1)                   | plano gratuito             | amostragem                                                    |
| Domínio                              | organizeup.com.br                | _preencher_                | —                                                             |

## Regras

- Heartbeat por intervalo **desligado** em todos os agentes; só atribuição, webhook e os crons abaixo.
- Crons fixos (America/Sao_Paulo), e nenhum outro sem decisão do fundador:
  - Tech Lead: rotina diária às **06:00** (até 3 tarefas de reparo por dia) e resumo semanal na **segunda às
    08:00**;
  - SRE: rotina diária às **07:30**.
- O Engenheiro e o Revisor/QA acordam só por atribuição, então o custo diário de Codex é limitado pelas
  tarefas que a rotina abre (no máximo 3 por dia).
- Os agentes diários do produto rodam no worker (04:00) e **não custam IA**: são regras, sem modelo nem
  cotação externa (ADR-0015). O custo deles é só tempo de CPU e banco já pagos no VPS.
- Erros (`ops.diagnostics`) e o MCP da equipe rodam na web e no Postgres já pagos, sem serviço externo. Os
  tetos ficam em `docs/ops-api.md`; o custo em Codex continua limitado pelas 3 tarefas de reparo por dia.
- Antes da Fase 3: fixar preço do plano e meta "custo de IA ≤ 20–25% do preço" medida por `ai_usage`.
- Relatórios e sugestões automáticos só para households ativos: 60 dias para os agentes diários do produto
  (ADR-0015), 30 dias para o assistente com IA da Fase 3.
