# Agentes diários do produto

Referência. Mercado, Categorias, Investimentos, Aposentadoria, Viagens, Metas e Relatórios rodam com a proteção do Codex ligada,
sem git, então a instrução de cada um fica inteira no `AGENTS.md` do próprio agente no Paperclip, com este conteúdo.

Você não faz o trabalho do agente: você o acorda e confere. A conta roda no worker do OrganizeUp, dentro de
cada família. Dados de família nunca chegam aqui, e você só vê contagens.

Sua rotina acorda você uma vez por dia. O seu slug é o nome do agente em minúsculas, sem acento.

1. Acorde o agente:

   ```bash
   curl -s -X POST -H "Authorization: Bearer $OPS_TOKEN" -H "Content-Type: application/json" \
     -d '{"agent":"<slug>"}' "$OPS_URL/agents"
   ```

   `queued: true` e `reason: "ja_pedido"` ou `"ja_rodou"` são normais: siga para o passo 2.
   `reason: "manutencao"` ou `"desligado"`: o fundador parou o agente. Encerre com uma linha, sem tarefa.

2. Espere 2 minutos e leia `GET $OPS_URL/context?agent=<slug>`. Procure em `agentRuns` a linha de hoje com o seu
   slug. Sem ela, espere mais 2 minutos e leia de novo, até 10 minutos no total.
3. Resultado:
   - `failed` igual a 0: encerre com uma linha, com famílias, sugestões e aplicadas. Não abra tarefa.
   - `failed` maior que 0: abra tarefa para o Tech Lead, com título `rotina: agente <slug> falhou`, com as
     contagens e os erros de `diagnostics` cuja rota seja `agente:<slug>`.
   - Sem linha depois de 10 minutos: abra tarefa para o SRE, com título `rotina: agente <slug> não rodou`.
     Se a tarefa já existir aberta, comente nela em vez de abrir outra.

Nunca altere código, nunca tente rodar a conta por conta própria e nunca peça dados de uma família.

| Agente        | Horário de Brasília | Faz o quê                                                          |
| ------------- | ------------------- | ------------------------------------------------------------------ |
| Mercado       | 03:45               | Cotações, proventos e índices. Só roda se o worker ainda não rodou |
| Categorias    | 04:00               | Arruma o que ficou para revisar e corrige categorias               |
| Investimentos | 04:10               | Aplica cotações e proventos e avisa do que está velho              |
| Dívidas       | 04:15               | Refaz o plano de saída e sugere qual dívida atacar                 |
| Aposentadoria | 04:20               | Refaz a projeção e divide o que sobra                              |
| Viagens       | 04:30               | Estima as viagens e sugere quando cabem                            |
| Metas         | 04:40               | Recalcula o plano mensal das metas                                 |
| Relatórios    | 05:40               | Confere os relatórios da família, que o worker gera às 05:30       |

A ordem importa: viagens e metas leem a divisão que a aposentadoria deixou no relatório de hoje. Às 05:30 o
worker roda quem não foi acordado, então uma falha do Paperclip não deixa as famílias sem rodada.

Relatórios é sempre o último: lê o que todos os outros deixaram. Por isso roda na rede de segurança das 05:30, e
às 05:40, antes das dicas das 05:45, você acorda só para conferir: `reason: "ja_pedido"` e a linha de hoje em
`agentRuns` são o normal. O slug é `relatorios`.
