# ADR-0016 — Metas, cadastro complementar e painel do serviço

Status: aceito (2026-10-31)

Substitui em parte o ADR-0014 ("objetivos que não sejam viagem" saem do fora do escopo) e preenche o que o
plano-mestre deixava para as Fases 6 e 7 (goals, onboarding progressivo e admin). As premissas numéricas dos
cálculos estão no ADR-0015. A especificação completa está em `docs/specs/agentes-diarios-metas-admin.md`.

## Decisão

### Metas

- **Tabela `goals` genérica** (veículo, imóvel, reforma, educação, compra, evento, outro), com valor, mês
  desejado, prioridade de 1 a 5, status (`planejando`, `juntando`, `concluida`, `pausada`), dia do mês para
  guardar, conta de onde sai e, opcionalmente, conta onde o dinheiro fica. Viagens continuam em `trips`.
- **A família informa; o assistente planeja.** Valor, data, prioridade e contas são dado informado. Início,
  fim, parcela mensal e nota são dado derivado, recalculados todo dia pelo agente `metas` (ADR-0015) a partir
  do orçamento de metas da alocação.
- **Parcelas em `goal_contributions`**, uma por mês, entram no calendário e nos lançamentos como "Meta: nome
  (k/n)" com chave `g:<meta>:<mês>`, na categoria de sistema "Metas e objetivos". Confirmar cria a despesa
  na conta de origem e, havendo conta destino, uma receita de mesmo valor nela, na mesma transação, e soma em
  `saved`. Parcela confirmada não é recalculada; o plano pula aquele mês.
- **Prioridade manda.** O orçamento vai primeiro para a meta de maior prioridade e, em empate, para a de data
  mais próxima. Meta que não cabe fica sem plano e a tela pede reduzir, adiar ou pausar outra.
- **Patrimônio**: o guardado em metas sem conta destino entra em "Guardado para metas"; com conta destino o
  dinheiro já está no saldo da conta e não conta duas vezes.
- **Categorias de sistema novas**: "Metas e objetivos" (despesa e receita) e "Aportes e investimentos"
  (despesa). O que a família guarda não conta como gasto no cálculo do excedente.

### Sugestões do assistente

- **Tabela `household_suggestions`** é a única porta de alteração sugerida ou automática: agente, tipo
  (categoria, fusão de categoria, aporte na reserva, aporte em dívida, aporte em investimento, viagem, meta,
  investimento, lembrete), título, texto, `payload` validado por zod ao aplicar, status (`pendente`,
  `aplicada`, `ignorada`, `desfeita`), quem aplicou (`familia` ou `agente`) e chave de deduplicação.
- **Aplicar e desfazer são ações da família na UI**, em `packages/agents/apply.ts`, que recarrega a sugestão
  dentro da transação da família, exige o status certo e revalida o payload. Desfazer categoria só se ninguém
  mudou os lançamentos depois.
- **Na UI a palavra é sempre "assistente"**; "agente" fica em código, ADR e Paperclip.

### Cadastro complementar

- **Quatro passos opcionais em `/app/completar`**, convidados pelo painel (primeiro item do checklist) e por
  um aviso no topo; nada bloqueia o uso. `onboarding_version` e `onboarding_completed_at` em
  `household_settings`. Quem já tem conta cai na mesma regra.
- **Finalidade de cada dado novo** (dado mínimo, ADR-0004):
  - nascimento (mês/ano) do titular e das pessoas: idade para aposentadoria e viagens;
  - `retirement_year`: ano em que a família quer parar; vazio usa `min(nascimento + idade de aposentadoria)`
    dos adultos, com 65 como padrão;
  - `trips_per_year` (0 a 12) e `trip_days` (1 a 60): quantidade e duração para o agente de viagens;
  - `work_status`, `inss_contributor`, `expected_pension`, `retirement_age` por pessoa: outra renda na
    aposentadoria e quando ela entra;
  - `wedding_month`/`wedding_year`: colocar uma viagem no mês do aniversário de casamento;
  - `wedding_day` é exceção ao dado mínimo, igual a `calendar_events.event_date`: só serve para criar o
    lembrete anual "Aniversário de casamento", é opcional e o evento é criado pela família, nunca pelo agente.
- **Política de Privacidade** lista os dados novos e explica os agentes (regras, sem IA, dentro do banco da
  família, nada sai para terceiros). Versão `2026-10-31`, sem re-aceite forçado.

### Aposentadoria

- **Plano por renda de proventos** em `retirement_plan` (1 por família): renda alvo, rendimento esperado,
  crescimento dos proventos e aporte. Campos vazios são derivados (ADR-0015). A tela principal é "Viver dos
  rendimentos"; o cenário antigo vira "Comparar: gastar o que guardou".
- **Reserva** ganha "Quanto guardar por mês" (`emergency_fund.contribution`), separado do gasto essencial, que
  não muda.

### Painel do serviço (`/admin`)

- **Versão mínima na Fase 2**, para o responsável acompanhar o serviço. Fica fora do grupo `/app`.
- **Identidade por id de usuário** em `ADMIN_USER_IDS`. `ADMIN_EMAILS` só em desenvolvimento e e2e: e-mail
  sem conta pode ser tomado por quem se cadastrar com ele. O gate `requireAdmin()` fica em
  `apps/web/src/lib/session.ts`, caminho já protegido; quem não está na lista recebe 404.
- **Só leitura.** A conexão admin da web abre com `default_transaction_read_only` e no máximo
  `ADMIN_DATABASE_POOL_MAX` conexões (padrão 2). Nenhuma página do admin escreve em dados de família.
- **Cada acesso é registrado** em `ops.admin_access` (quando, quem, qual ação, qual família se houver). O
  texto da busca nunca é guardado.
- **Dados pessoais mínimos.** A lista de famílias mostra nome, data de criação, membros, última sessão e
  cadastro complementar. O e-mail do responsável só aparece ao expandir uma linha, e isso é uma ação
  registrada. Busca por nome ou por e-mail exato de um membro, devolvendo só aquela família.
- **Métricas agregadas**: famílias, usuários, novas em 7 e 30 dias, ativas em 30 dias, cadastros pendentes,
  tabela dos agentes diários (7 dias) e saúde (commit da web e do worker, último heartbeat, versão do schema).

## Fora do escopo por enquanto

2FA do admin. Escrita pelo admin. Importar metas dos sistemas antigos. E-mail avisando das sugestões.
Parcelas de proventos previstos no calendário. `projection_snapshots` (descartado no ADR-0014; o relatório
diário em `household_reports` cumpre o papel de histórico).

## Riscos aceitos

- **Admin sem 2FA.** Quem tiver a senha de um id em `ADMIN_USER_IDS` vê dados agregados e, por ação explícita,
  o e-mail do responsável de uma família. Mitigação: só leitura, acesso registrado, e a lista é por id, não por
  e-mail.
- **Dia do casamento é dado além do mínimo.** Aceito porque é opcional e tem a mesma finalidade de um evento
  do calendário criado pela família.
- **Plano de meta muda todo dia.** A família pode estranhar a parcela mudar quando a renda muda. Mitigação:
  rodapé explicando, nota no plano com o motivo, e parcela confirmada nunca muda.
- **Duas contas para uma parcela de meta** (origem e destino) geram dois lançamentos. É intencional, para o
  saldo das contas fechar; a tela mostra "Guardar" em vez de "Pagar".
