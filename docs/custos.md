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
- Ler arquivo de dívida é a única parte da rotina de dívidas que usa IA: uma chamada por arquivo, na rota
  `dividas` de `ai_usage`, dentro dos mesmos tetos do assistente. O agente diário de dívidas segue por regras.
- Erros (`ops.diagnostics`) e o MCP da equipe rodam na web e no Postgres já pagos, sem serviço externo. Os
  tetos ficam em `docs/ops-api.md`; o custo em Codex continua limitado pelas 3 tarefas de reparo por dia.
- Antes da Fase 3: fixar preço do plano e meta "custo de IA ≤ 20–25% do preço" medida por `ai_usage`.
- Relatórios e sugestões automáticos só para households ativos: 60 dias para os agentes diários do produto
  (ADR-0015), 30 dias para o assistente com IA da Fase 3.

## Importador inteligente (ADR-0030)

Haiku 5.5: US$ 0,10 por milhão de tokens de entrada e US$ 0,50 de saída, até 100 mil tokens de prompt. Instruções em cache
depois do primeiro arquivo do lote. Leitura por regras não custa nada. Estimativa sem uso real: conferir em `ai_usage`,
rota `importador`.

| Arquivo                                 | Entrada       | Saída   | Custo estimado |
| --------------------------------------- | ------------- | ------- | -------------- |
| Contrato de 10 páginas com texto        | 8 mil tokens  | 1,5 mil | US$ 0,002      |
| Pior caso de texto (120 mil caracteres) | 40 mil tokens | 8 mil   | US$ 0,008      |
| Digitalização de 20 páginas             | 60 mil tokens | 2 mil   | US$ 0,007      |
| Pior caso de saída (24 mil tokens)      | 40 mil tokens | 24 mil  | US$ 0,016      |

**Por família:** 30 arquivos no mês custam de US$ 0,06 a US$ 0,24 no pior caso realista, cerca de R$ 0,35 a R$ 1,40. Teto
duro: 1,5 milhão de tokens por mês, cerca de US$ 0,30. O teto diário (200 mil tokens) e o mensal do serviço continuam
valendo.

**Armazenamento:** até 100 MB por família no banco e no backup, além dos 50 MB de dívidas. Lote sem aprovação some em 30
dias.
