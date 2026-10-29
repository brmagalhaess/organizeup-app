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

- Heartbeat por intervalo **desligado** em todos os agentes; só atribuição, webhook e no máximo um
  cron diário para Tech Lead e SRE.
- Antes da Fase 3: fixar preço do plano e meta "custo de IA ≤ 20–25% do preço" medida por `ai_usage`.
- Relatórios automáticos só para households ativos nos últimos 30 dias.
