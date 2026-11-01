# ADR-0015 — Agentes diários do produto e automação da equipe

Status: aceito (2026-10-31). Cotação externa e aviso de preço velho: ver ADR-0017. A parte "sem modelo de IA" foi
substituída pelo ADR-0018; os cinco agentes diários continuam por regras.

Substitui em parte o ADR-0010 (rotina e merge da equipe do Paperclip), o ADR-0013 (o agente de categorias
passa a aplicar sozinho um caso bem delimitado) e o ADR-0014 (aposentadoria por acumulação deixa de ser o
plano principal; estimar custo de destino deixa de estar fora do escopo). A especificação completa está em
`docs/specs/agentes-diarios-metas-admin.md`.

## Decisão

### Agentes diários dentro do produto

- **Cinco agentes rodam no worker, toda madrugada** (`categorias`, `investimentos`, `aposentadoria`,
  `viagens`, `metas`), numa fila `daily-agents` com cron às 04:00 (America/Sao_Paulo). Rodam no produto, e não
  no Paperclip, pelo mesmo motivo do ADR-0013: leem dados pessoais da família.
- **Uma família por transação**, com `fromJob` e `withHousehold`, um agente por transação, erro de uma família
  não para as outras. O log guarda só o id da família, o nome do agente e o código do erro.
- **Sem modelo de IA e sem cotação externa.** Tudo é regra em `packages/domain` (ADR-0013 e ADR-0012
  continuam valendo nisso). As leituras compartilhadas e a lógica de aplicar ficam em `packages/agents`,
  usadas pelo worker e pela web.
- **Só famílias ativas.** Família ativa é a que tem algum membro com sessão atualizada nos últimos **60 dias**.
  Famílias paradas não geram cálculo nem sugestão.
- **Idempotente.** Rodar duas vezes no mesmo dia dá o mesmo resultado. Sugestões fazem upsert por chave de
  deduplicação enquanto estão pendentes; relatórios fazem upsert por família, tipo e dia.
- **`DAILY_AGENTS_ENABLED=false` desliga tudo** sem mexer no código. É o interruptor de emergência.
- **Para a equipe de engenharia, só contagens** em `ops.agent_runs` (dia, agente, execuções, famílias,
  sucesso, falhas, sugestões, aplicadas, duração), expostas em `/api/ops/context` como `agentRuns`. Nenhuma
  linha permite identificar uma família.

### Dado derivado × dado informado (nova regra 7 do AGENTS.md)

- **O que a família informou só muda por sugestão aceita na UI**: valor e data da meta, categoria escolhida,
  custos de uma viagem, renda alvo, aporte digitado.
- **O que o sistema calcula a partir disso é dado derivado** e o worker recalcula e sobrescreve todos os dias:
  plano mensal da meta, aporte sugerido, destino sugerido, projeção de aposentadoria e a categoria de
  lançamento que ficou "para revisar" na importação.
- **Toda alteração automática fica registrada** em `household_suggestions` com `status = 'aplicada'`,
  `applied_by = 'agente'` e o estado anterior no `payload`, com botão **Desfazer** na tela Sugestões.
  Desfazer marca `desfeita` e bloqueia aquela alteração automática para sempre.
- **Categoria: o agente só mexe sozinho no que ainda está "para revisar"** (`category_source = 'revisar'`, ou
  lançamento antigo importado que caiu na categoria genérica). Categoria escolhida pela família nunca muda
  sem aceite. Memória aprendida pelo agente só gera sugestão; só a memória confirmada pela família decide
  sozinha.
- **Sugestão ignorada volta depois de 30 dias**; sugestão desfeita não volta.

### Premissas numéricas (também no cabeçalho dos módulos)

- **Excedente**: só meses fechados com lançamento; `min(média, mediana)` com 6 meses ou mais; mediana com 3 a
  5; abaixo de 3 usa a previsão (renda líquida típica menos despesas recorrentes). O que a família guarda em
  metas e aportes não conta como gasto.
- **Folga de 10%** sobre o excedente antes de dividir.
- **Divisão do que sobra**, nesta ordem: até **50%** para completar a reserva; até **70%** do resto para
  dívidas caras; até **70%** do resto para a aposentadoria; o que sobrar vai **metade para metas e metade para
  viagens**. Viagens já confirmadas são descontadas uma vez, na parte das viagens.
- **Dívida cara** é a que custa mais de **1% ao mês** ou mais que a taxa mensal do rendimento usado. Quitar
  rende mais que investir, e a tela diz isso.
- **Aposentadoria por renda de proventos** (carteira perpétua): renda alvo = o que a família informou, ou
  `max(gasto essencial × 1,2, gasto médio de 12 meses)`. Carteira necessária = renda que falta × 12 ÷
  rendimento anual. Rendimento observado = proventos líquidos de 12 meses ÷ valor dos ativos pagadores
  (anualizado entre 3 e 12 meses; abaixo de 3 meses fica fora). **Rendimento válido entre 1% e 20%**; fora
  disso é "suspeito" e usa o informado. Em reais de hoje, proventos líquidos do imposto retido, reinvestidos
  ao mesmo rendimento, preço acompanhando os proventos; não prevê mudança de tributação. O cenário antigo
  por consumo de patrimônio continua como comparação, dobrado na tela.
- **Metas**: teto de **120 meses**; parcela mínima de **1%** do que falta; acima disso a meta fica sem plano e
  a tela pede reduzir, adiar ou aumentar.
- **Viagens**: criança abaixo de 12 anos conta **0,7** em alimentação e transporte e 1,0 em passagem; hospedagem
  cobre até 4 pessoas e soma **50% por pessoa extra**; dias = os informados ou `max(mínimo do destino, 5)`;
  primeira viagem nunca antes de 4 meses.
- **Investimentos**: preço com mais de **30 dias** gera aviso; classe com desvio de 10 pontos da meta gera
  nota informativa, nunca ativo para comprar ou vender (CVM, ADR-0012).
- **Categorias**: a revisão olha os últimos **90 dias** de lançamentos.
- **Tabela de destinos** (`trip_destination_templates`): global, somente leitura, cada linha com fonte real e
  data, valores arredondados à centena e nível de confiança `baixa` ou `media`. Linha sem fonte não entra.
  Passeios não são estimados. O SRE lembra de revisar a tabela todo mês de outubro.

### Exceção única à regra 3

- A migração `0016` troca a restrição `household_reports_kind_check` (DROP CONSTRAINT + ADD CONSTRAINT) para
  aceitar os tipos `categorias`, `investimentos`, `aposentadoria`, `viagens` e `metas`. É a única operação
  não aditiva autorizada; o cabeçalho do SQL cita este ADR. Nenhuma linha é perdida.

### Equipe do Paperclip (substitui parte do ADR-0010)

- **Rotina diária de revisão do sistema.** Tech Lead às 06:00: lê `/api/ops/context` (com `agentRuns`) e
  `/api/ops/deployments`, roda `pnpm check` em checkout limpo de `main`, revisa o que está aberto e abre **até
  3 tarefas de reparo por dia**, com prefixo `rotina:`. SRE às 07:30 (saúde e `agentRuns`). Resumo semanal
  do Tech Lead na segunda às 08:00.
- **Lista fechada de reparos**: teste, lint ou typecheck quebrado; erro visível em produção; texto errado;
  estado vazio ou de erro faltando; dependência com aviso; documentação desatualizada; `agentRuns.failed >
0`; deploy que não acompanhou `main` por mais de 30 minutos. Rotina não abre funcionalidade nova.
- **O Tech Lead não roda build.** O build é verificado pelo deploy: se o `commit` do último deploy for
  diferente do SHA de `main` por mais de 30 minutos, abre tarefa.
- **Tudo entra sem humano, por decisão do fundador em 2026-10-31** ("liberar tudo"). Qualquer PR, inclusive
  `rotina:` e risco alto, com `pnpm check` verde no checkout do Revisor/QA, é mesclado sem esperar ninguém. O
  Revisor confere depois que `/api/health` mostra o commit do merge.
- **Risco alto ganha revisão reforçada**, não espera: pedido da tarefa, nenhum teste enfraquecido, isolamento
  intacto, fonte em regra financeira, migração aditiva, e coluna nova num PR antes do código que a usa. A
  lista de caminhos é a de `.github/workflows/risk-label.yml`, repetida em `paperclip/agentes/comum.md`.
- **Migração que apaga ou altera dados continua esperando o fundador** (regra 3 do `AGENTS.md`): é a única
  mudança que `git revert` não desfaz.
- **Não há CI nem proteção de branch.** `pnpm check` local é o único portão. `/api/health` mostra o commit real
  desde `c9f23d0`.

## Fora do escopo por enquanto

Cotação automática e importação B3. IA generativa nos agentes. E-mail avisando das sugestões (sem SMTP).
Migrar os cenários antigos de aposentadoria para o plano por proventos (convivem). Parcelas de proventos
previstos no calendário. Retentativa automática e fila morta no pg-boss.

## Riscos aceitos

- **Alteração automática de categoria.** Mesmo restrita ao que estava "para revisar", pode errar. Mitigação:
  tudo fica listado em "O que o assistente fez sozinho" por 7 dias, com Desfazer, e o que foi desfeito não
  volta.
- **Merge sem humano em qualquer risco.** Sem CI e sem proteção de branch, um erro em banco, regra financeira,
  login ou nas instruções dos próprios agentes vai para produção sozinho, e pode expor ou corromper dados de
  famílias. O fundador conhece e aceitou esse risco. Mitigação: `pnpm check` no checkout do Revisor, revisão
  reforçada, lista fechada de reparos na rotina, no máximo 3 por dia, backup diário e `git revert` pelo SRE.
- **Estimativas de viagem e aposentadoria são aproximadas.** A tela diz isso em todo lugar e nada é
  recomendação de investimento. A tabela de destinos envelhece; a revisão anual depende do fundador.
- **Cinco agentes em sequência para todas as famílias ativas** podem demorar quando a base crescer. Hoje cabe
  na janela da madrugada; um job por família fica para quando for preciso.
