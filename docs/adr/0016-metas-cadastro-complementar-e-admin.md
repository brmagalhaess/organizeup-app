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
- **Leitura e escrita separadas.** Tudo o que só lê vai por `withAdminRead`, conexão com
  `default_transaction_read_only`. Ação vai por `withAdmin`, dentro de uma transação que grava também o
  registro em `ops.admin_access`: a mudança e o registro entram juntos. As duas conexões respeitam
  `ADMIN_DATABASE_POOL_MAX` (padrão 2).
- **`requireAdmin()` em toda página e em cada server action.** `admin-guard.test.ts` reprova o arquivo de
  ações que esquecer.
- **Cada acesso e cada ação são registrados** em `ops.admin_access` (quando, quem, qual ação, qual família ou
  conta). Nunca guarda o texto da busca, nem nome, nem e-mail. Busca sempre por POST: e-mail não vai para URL.
- **Dados pessoais mínimos.** Lista e detalhe de família mostram nome da família, datas, papéis e módulos
  usados (sim ou não). Conta aparece por um código curto. Nome e e-mail só de quem é responsável de família (ou
  de conta sem família), por ação explícita e registrada. Sem valores, sem lançamentos, sem "entrar como
  usuário". Busca de família por nome ou e-mail exato; de conta só por e-mail exato ou id.
- **Telas**: visão geral, famílias, usuários, agentes, sistema, controles e auditoria, com menu lateral próprio
  e barra no celular.
- **Métricas**: as contagens de `user` e `household` saem na hora, só de tabelas de auth. Adoção por módulo e
  atividade vêm de `ops.platform_stats`: fila `platform-stats` às 03:15 e no boot, uma família por transação
  com RLS, soma e grava só números. Fila própria porque a contagem não pode depender dos agentes estarem ligados.
- **Suspender família e bloquear conta** usam `household.suspended_at` e `user.blocked_at`, conferidos em
  `requireTenant`, `requireSession` e no hook de criação de sessão do Better Auth. As duas ações encerram as
  sessões na hora. Família suspensa entra mas vê `/app/suspensa`; conta bloqueada não entra. Nenhum administrador
  age sobre a própria conta ou sobre a família de que participa. A suspensão também tira a família da rodada dos
  agentes.
- **Essas colunas ficam fora de `user` e `household` no Drizzle** (`userAccess`, `householdAccess`, mesmas
  tabelas): o Better Auth lê todas as colunas declaradas, e o login cairia até a migração chegar. O portão tolera
  `42703` e `42P01`, valendo "liberado", porque a web pode subir antes do worker.
- **Excluir** usa o mesmo `DELETE` em cascata. Família exige digitar o nome, conferido de novo no servidor. Conta
  exige digitar EXCLUIR e segue a regra de "apagar minha conta": famílias só dela somem junto; família com mais
  gente impede.
- **Redefinição de senha** chama a mesma API do Better Auth. Sem envio de e-mail configurado, o pedido fica
  registrado e a tela avisa.
- **Chaves do sistema em `ops.feature_flags`**, tudo desligado por padrão: `manutencao`, `cadastro_fechado`,
  `agente_desligado:<agente>` e `aviso:<id>`. Só `ou_admin` grava; web e worker leem.
  - Manutenção: faixa no app e `requireTenant` devolve contexto de papel `viewer`, então `canWrite()` responde
    não em todas as ações e a RLS recusa a escrita. Rotas de escrita do Better Auth (cadastro, família, conta)
    respondem 503. O worker pula agentes e foto do patrimônio. A rodada perdida não é refeita sozinha.
  - Cadastro fechado: quem tem convite pendente para o e-mail ainda se cadastra.
  - Agente desligado não roda nem grava `ops.agent_runs`. Sem a aposentadoria, viagens e metas seguem como quando
    ela falha.
- **"Rodar agora" enfileira na mesma fila `daily-agents`**, com `singletonKey` do dia e janela de 5 minutos. Em
  fila `standard` do pg-boss a chave sozinha não evita duplicata; quem evita é o par chave e janela.
- **Central dos agentes (2026-11-01).** `/admin/agentes` lista os agentes do produto a partir de `info.ts`, mais
  Mercado e Dicas e quem só aparecer em `ops.agent_runs`, com interruptor e "Rodar agora" por agente. A equipe do
  Paperclip é um catálogo em código: a web não tem acesso à API de lá, então o estado ao vivo fica no Paperclip e
  o painel mostra só o que foi registrado em `ops.reports`, `ops.agent_memory` e `ops.agent_runs`. Sem registro, diz
  "Sem registro ainda", nunca um status inventado.
- **Assistente na família (2026-11-01).** O detalhe mostra ligado ou não, data do aceite, nível de autonomia e
  contagens de dicas, memórias e tokens do mês, sem ler nenhuma coluna de texto. O resultado de `Testar a IA` fica em
  `ops.admin_access`, de onde sai o alerta. Rota nova em `ops.ai_stats` aparece sozinha em `/admin/sistema`.

## Fora do escopo por enquanto

2FA do admin. Importar metas dos sistemas antigos. E-mail avisando das sugestões.
Parcelas de proventos previstos no calendário. `projection_snapshots` (descartado no ADR-0014; o relatório
diário em `household_reports` cumpre o papel de histórico).

## Riscos aceitos

- **Admin sem 2FA, agora com escrita.** Quem tiver a senha de um id em `ADMIN_USER_IDS` pode suspender, bloquear
  e excluir, e vê por ação explícita o contato do responsável. Mitigação: tudo registrado na mesma transação da
  ação, confirmação em toda ação destrutiva, exclusão só digitando, e a lista é por id, não por e-mail. 2FA do
  admin passa a ser a próxima prioridade de segurança.
- **Suspender derruba a sessão também nas outras famílias do membro.** Ele só precisa entrar de novo.
- **Dia do casamento é dado além do mínimo.** Aceito porque é opcional e tem a mesma finalidade de um evento
  do calendário criado pela família.
- **Plano de meta muda todo dia.** A família pode estranhar a parcela mudar quando a renda muda. Mitigação:
  rodapé explicando, nota no plano com o motivo, e parcela confirmada nunca muda.
- **Duas contas para uma parcela de meta** (origem e destino) geram dois lançamentos. É intencional, para o
  saldo das contas fechar; a tela mostra "Guardar" em vez de "Pagar".
