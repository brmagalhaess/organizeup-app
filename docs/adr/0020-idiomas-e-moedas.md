# ADR-0020 — Idiomas e moedas

Status: aceito (2026-11-01).

Pedido do fundador. Soma ao ADR-0004 (dinheiro), ao ADR-0015 (agentes, que desde a Fase 3 gravam chave e valores ao
lado do texto em português) e ao ADR-0018 (o assistente passa a responder no idioma da pessoa). A especificação e as fases estão em
`docs/specs/idiomas-e-moedas.md`. Este ADR registra o que já vale. A moeda em conta nasceu na Fase 5; moeda principal fora do real
veio na Fase 6, e o que ela muda está na seção própria.

## Decisão

### O que é de quem

- **Idioma é da pessoa; moeda principal é da família.** Na mesma família, cada um escolhe o idioma, e todos veem os
  totais na mesma moeda.
- **Idiomas:** português do Brasil, inglês e espanhol. **pt-BR é sempre o padrão e o fallback.**
- **Moedas:** real, dólar e euro. Real é o padrão. Valores em `numeric(14,2)`, com `packages/domain`. Nada é reescrito.

### `next-intl`, sem prefixo no endereço

- **Por que `next-intl`:** é a biblioteca feita para o App Router: a mesma API em componente de servidor e de navegador,
  `getTranslations` em server action e metadata, ICU com plural e marcas de texto rico, e chaves conferidas pelo
  TypeScript com `AppConfig`. Aceita Next.js 16 e funciona sem rotas por idioma, que é o que queremos no app. As
  alternativas não fecham: `react-i18next` pede ponte própria para o servidor, e o guia do Next.js só resolve o
  dicionário, sem plural, sem texto rico e sem as chaves tipadas. Versão fixa: 4.14.9. O navegador recebe só o catálogo do
  idioma atual.
- **Sem prefixo de idioma no app:** `/app/metas` é o mesmo endereço em todo idioma. Prefixo mudaria todos os links, os
  redirecionamentos e os e-mails já enviados, e não traz nada atrás de login. A landing tem `/en` e `/es` por causa de
  busca, com `hreflang`, título e descrição em cada idioma.
- **Sem middleware no app.** O idioma é resolvido em `i18n/resolve.ts`, por requisição: **conta, depois cookie, depois
  `Accept-Language`, depois pt-BR**. A exceção é `proxy.ts`, só para `/en` e `/es`: ali o endereço manda, e o proxy avisa
  `resolveLocale` por um cabeçalho. O layout raiz não conhece o endereço e, sem isso, `<html lang>` seguiria o cookie numa
  página que a busca indexa em outro idioma. `/` continua seguindo a pessoa; para a busca, que não manda idioma, é português. O layout raiz lê cookie, então nenhuma tela é mais pré-renderizada no build: é o
  preço de ter `<html lang>` certo sem prefixo. A detecção não grava nada: cookie só nasce de uma escolha.
- **Idioma nunca derruba tela.** Sem banco ou sem tabela, a leitura da conta devolve nada e segue para o cookie.

### Onde a escolha fica

- **`user_preferences`, tabela própria, e não coluna em `user`.** O Better Auth lê todas as colunas declaradas em `user`
  e, como a web sobe antes do worker migrar, uma coluna nova ali derrubaria o login (o mesmo motivo de `userAccess`). Sem
  a tabela, a leitura devolve nada e a gravação devolve `false`: vale o cookie, e a conta alcança depois. A tabela é da
  pessoa, fora da RLS de tenant, como `legal_acceptance` (ADR-0002).
- **CHECK por formato, e não lista fechada.** Trocar uma CHECK não é aditivo (regra 3); idioma novo só muda a web, que é
  quem confere os aceitos.
- **Cookie `organizeup_locale`, um ano, `httpOnly`, `SameSite=Lax`.** Trocar de idioma grava os dois, então sair da conta
  mantém a tela no mesmo idioma. É cookie novo: a Política de Privacidade passou a citá-lo (`LEGAL_VERSION` .5).
- **Quem escolhe o idioma antes de ter conta** leva a escolha para a conta no cadastro.
- **O idioma é da pessoa, não dado da família:** muda também na manutenção e para quem só pode ver.
- **Fora da auditoria da família.** Apagar a conta apaga a preferência (FK em cascata).

### Textos

- **`apps/web/messages/{pt-BR,en,es}.json`, por área.** O teste do `pnpm test` confere: mesmas chaves, mesmas variáveis e
  marcas ICU, nenhum texto vazio, todo texto é ICU válido. Texto novo de tela vai para lá.
- **Fallback em duas camadas.** O catálogo de inglês e de espanhol é o português com o que existe por cima, então chave
  que falta, ou texto vazio, aparece em português. Se ainda assim algo quebrar, sai `…`, nunca a chave.
- **Tela não traduzida**, como o painel do serviço, **aparece em português**, sem aviso na tela, marcada com `lang="pt-BR"` para o leitor de tela.
- **Datas e números das telas traduzidas** passam por `i18n/format.ts`, com `Intl` e o idioma da pessoa. Nunca `pt-BR`
  escrito no código de tela traduzida. Dinheiro nessas telas sai com o formato do idioma e continua em reais, porque
  a moeda principal segue sendo o real (`R$1,234.56` em inglês, `1234,56 R$` em espanhol).
- **Validação no servidor** continua com a mensagem em português nos esquemas compartilhados, que telas não traduzidas
  usam. A action de tela traduzida troca a mensagem pelo campo, ou pela frase com `knownText`. Esquema que só uma tela usa
  já nasce com o texto do catálogo. Some quando todas as telas forem traduzidas.
- **Confirmar compromisso** passa por `ConfirmEntryButton`. Em conta estrangeira sem cotação nada é gravado, e um aviso
  abre por cima da tela dizendo a moeda e a data.
- **Termos e Privacidade continuam em português**, com aviso curto no idioma da pessoa dizendo que é a versão que vale.
  Tradução de cortesia só com revisão jurídica de cada país.

### Assistente

- **Idioma vai em `turnContext`, nunca em `SYSTEM_PROMPT`**, que é o prefixo do cache de prompt. Em português o contexto
  fica igual ao de sempre; em inglês e espanhol ele também sobrepõe o formato de valores das instruções.
- **A conferência determinística entende os dois formatos.** `uncheckedAmounts` lê `R$ 1,234.56` e `1.234,56 R$`, e
  `mentionsInvestment` conhece as palavras em inglês e espanhol. Sem isso, resposta em inglês daria aviso falso de número
  e deixaria de levar o aviso da CVM.
- **As dicas da madrugada saem no idioma de quem definiu o aceite** (`ai_consent_by` e sua preferência), em português sem
  preferência, pelo mesmo `turnContext`. A dica é escrita pelo modelo e fica num idioma só, por família. O verificador
  conhece número, ordem de compra e venda e texto de instrução em inglês e espanhol. A base de conhecimento continua
  brasileira.

### Agentes e e-mails (Fase 3, 2026-11-01)

- **Chave e valores ao lado do texto.** `household_suggestions`, `household_notifications`, `household_reports` e
  `debt_plan_reports` ganham `message_key` e `message_params`; `goals` ganha `plan_note_key` e `plan_note_params`.
  `title`, `body` e `summary` continuam em português: é a reserva de linha antiga e o que o assistente lê. Nada é
  reescrito: sem chave, a tela mostra o texto gravado, marcado com `lang="pt-BR"`, e o plano da meta alcança na rodada da
  noite.
- **Valores crus, com o tipo junto.** `{ money }`, `{ month }`, `{ date }`, `{ percent }`, `{ quantity }`, `{ monthName }`,
  `{ category }`, `{ categories }`, e frases dentro de frases (`{ message }`, `{ messages }`). Quem formata é a tela, em
  `i18n/agent-text.ts`. Valor em formato desconhecido ou chave que a versão não conhece caem no texto gravado: tela de
  versão antiga não quebra com worker novo.
- **Um lugar para escrever.** Tudo o que os agentes dizem está em `packages/agents/src/texts.ts`, com português e chave
  lado a lado; as chaves estão em `packages/domain/src/messages.ts`, com tipo. `agent-text.test.ts` confere, por chave, que
  o catálogo em português dá o mesmo texto gravado, letra por letra, e que toda chave existe nos três idiomas. Por isso o
  português visível não mudou.
- **Texto do sistema é traduzido na exibição, sem reescrever linha.** `i18n/system-text.ts` é a função única: nome padrão
  de categoria e de conta, só enquanto for exatamente o padrão, e descrições geradas. "Fatura" e "Aporte em" só contam com
  a categoria do sistema, e "Viagem:" só em evento nascido de viagem: "Fatura da luz" digitada fica como está. No formulário
  de editar, o nome aparece traduzido, e salvar sem mudar mantém o gravado.
- **Respostas de aceitar e desfazer** vêm com `code`, e a tela traduz pelo catálogo (`APPLY_REPLIES`). Arquivos de dívida
  também. `knownText` fica só para validação de esquemas compartilhados, em `/app/completar`.
- **Categoria nova criada pela IA** nasce no idioma de quem definiu o aceite: é dado da família, gravado num idioma só.
- **E-mail no idioma de quem recebe.** Preferência da conta, depois o idioma do pedido. No convite, a preferência de quem
  já tem conta com aquele e-mail, depois a de quem convidou. Ler o idioma fica fora do tempo do pedido: "esqueci a senha"
  continua sem revelar quais e-mails têm conta. A remetente não muda.
- **Link da landing leva o idioma.** `/entrar?lang=en` e `/cadastro?lang=en`: o clique em `/en` conta como escolha, e
  `proxy.ts` grava o cookie, que o cadastro leva para a conta.

### Dinheiro

- **`formatMoney(value, currency, locale, style)`** é a função única; `formatBRL` e as variantes curtas delegam e dão o
  mesmo texto, conferido por propriedade contra os formatadores antigos.
- **Real sai com `narrowSymbol`**, porque o símbolo normal do real em espanhol é `BRL`. Dólar fica com `symbol`, porque o
  estreito tira o `US` e deixa `$` ambíguo em pt-BR.
- **`parseMoney(input, locale)` não adivinha.** Com os dois separadores, o último é o decimal. Com um só, a dúvida existe
  apenas em `1.234` e `1,234`, e aí vale o idioma. Nos outros casos só uma leitura é possível, e o que não fecha em
  nenhuma é erro. A mensagem de erro não repete o que foi digitado. `parseBRL` não muda.

### Contas em dólar e euro (Fase 5, 2026-11-01)

Escrito para família em real. Desde a Fase 6, onde esta seção diz reais, leia moeda principal da família.

- **`transactions.amount` continua sempre em reais.** Muda o que a especificação previa, "cada valor na moeda da conta".
  Resumos, planos, agentes, IA e calendário somam essa coluna em cerca de 50 arquivos. Com dólar nela, todos teriam de
  converter, e o que ficasse para trás somaria dólar com real sem erro nenhum. Assim, nada disso muda: lançamento em conta
  estrangeira guarda ao lado `original_amount`, `original_currency` e `fx_rate`, nulas em conta em real, com CHECK de
  que ou as três são nulas ou nenhuma é. Quem precisa do valor da conta usa `coalesce(original_amount, amount)`.
- **A cotação fica congelada no lançamento.** O resumo de outubro não muda em novembro. Editar valor ou data recalcula pela
  cotação da nova data; mudar descrição ou categoria, não.
- **Valor digitado × compromisso em reais.** Digitado em dólar, `amount` é `original × cotação`, arredondado
  (`entryFromTyped`). Fatura, parcela, meta, aporte e renda são dívidas em reais: pagos com conta estrangeira, o real fica
  exato e o que sai da conta é ele dividido pela cotação (`entryFromReais`). Nesse caso `amount` pode diferir por centavos
  de `original × cotação`: uma fatura de R$ 543,21 precisa aparecer como R$ 543,21, e não como R$ 543,20.
- **Saldo em um lugar só.** `accountBalances`, em `packages/db`, devolve `nativeBalance` na moeda da conta e `balance`
  sempre em reais pela última cotação. Telas e agentes que somam contas continuam somando `balance`, e reserva, patrimônio,
  calendário e assistente acertam sem mudar a soma. A conversão é uma função só, `balanceInReais`. Sem cotação, a conta
  fica fora da soma e a tela diz qual moeda faltou.
- **Conta em real não muda em nada.** Sem conta estrangeira, nem `market_fx` é lida na soma de saldos, e nenhuma tela ganha
  texto novo: `fx` é null e `MonthEntry` não ganha campos.
- **Transferência entre moedas:** `amount` é o que saiu, `to_amount` o que entrou e `fx_rate` a taxa real, que sai dos
  dois valores e não da PTAX: é reais por unidade estrangeira, ou destino por unidade de origem entre duas estrangeiras.
  Nulos: mesma moeda. A diferença de câmbio fica fora de receita e gasto, como toda transferência.
- **Conta em moeda estrangeira não aceita conta que se repete.** `cashflow_plans.amount` entra nas previsões em reais e não
  tem coluna de origem: uma previsão de US$ 100 convertida na criação viraria outro valor em dólar a cada mês. A tela tira
  a opção e a action recusa.
- **Importar.** Os valores do arquivo estão na moeda da conta e cada linha converte na sua data. Comparar com o que já
  existe usa o valor original, então a deduplicação vale em dólar, e a impressão digital é a da linha do arquivo.
  Compromisso em reais não pareia com linha em dólar: entra como novo.
- **Cotação: PTAX de venda, SGS do Banco Central, sem chave.** Série 1 para dólar e 21619 para euro. Na primeira rodada, 10
  anos em blocos de 2 anos; depois, do dia seguinte ao último gravado até hoje. Quem falha no meio retoma de onde parou.
  `market_fx` é global, com os grants de `market_quotes` (todos leem, só `ou_worker` grava, ninguém apaga). Só sai do
  sistema o código da série e as datas, então a Política de Privacidade não muda.
- **`fxRateOn(tx, moeda, data)`** devolve a cotação do dia ou a última anterior. Sem cotação nenhuma, o formulário recusa.

#### O que o Banco Central devolveu de verdade em 2026-11-01

- `bcdata.sgs.1` em 28, 29 e 30/10/2026: 5.3420, 5.3744, 5.4212. `bcdata.sgs.21619`: 5.9515000, 6.0000000, 6.0522000.
- Conferência: o boletim "Fechamento PTAX" de 30/10/2026, na API PTAX do Olinda, traz dólar 5,4206 na compra e 5,4212 na
  venda, e euro 6,0505 e 6,0522. As séries 10813 e 21620 são as de compra. A 21619 é mesmo euro: a 21623 é libra (7.26330).
- Janela de 10 anos (01/11/2016 a 31/10/2026) responde 200, com 97,8 KB; 12 anos responde 406: "no máximo, 10 anos em
  séries de periodicidade diária".
- Intervalo sem valor, como um fim de semana, responde 404 com `Value(s) not found`: é lista vazia, não erro.
- `/dados/ultimos/25` responde 400: o máximo são 20 pontos. Por isso o histórico usa `dataInicial` e `dataFinal`.

### Moeda principal fora do real (Fase 6, 2026-11-01)

- **`transactions.amount` é sempre na moeda principal da família.** O desenho da Fase 5 continua: a soma não converte
  nada. O que muda é o que é estrangeiro: é a moeda diferente da principal. Em família em dólar, a conta em real é a
  estrangeira. Família em real não nota nada.
- **`household_settings.main_currency`, e não `currency`.** A coluna `currency` tem `CHECK (currency = 'BRL')` desde a 0002,
  e trocar CHECK não é aditivo (regra 3). A migração `0033` é só aditiva: coluna nova, e `currency` fica em `BRL`, sem uso.
  O mesmo vale para `transactions.original_currency`, que só aceita dólar e euro: a conta em real de família em dólar ou
  euro guarda a origem em `brl_amount` e `brl_rate`, com CHECK de par completo e de uma origem só. `EntryMoney` escreve as
  colunas certas; quem lê usa `entryOrigin`, e `accountBalances` soma `coalesce(original_amount, brl_amount, amount)`.
- **Real como pivô.** `market_fx` guarda reais por unidade. `crossQuote` dá a cotação entre quaisquer duas moedas, com o dia
  da mais antiga e 8 casas, as da coluna que a congela; `convertMoney` converte sem arredondar no meio. Lançamento de R$ 0,01
  em família em dólar vira US$ 0,01: a coluna recusa zero.
- **Escolha.** Ao criar a família, com real pré-selecionado, e em Configurações só sem lançamento, compra de cartão, dívida,
  investimento, meta nem transferência (`householdHasMovement`). Não existe conversão de histórico. Ao mudar, conta sem saldo
  inicial acompanha; conta com saldo fica na moeda dela, e passa a ser estrangeira.
- **Regras brasileiras em uma pergunta só: `brazilRulesApply(currency)`.** Fora do real somem, sem apagar dado: CLT e tabelas
  fiscais (a renda vale pelo valor cadastrado, `plainIncomes`), INSS e benefício no plano e no cadastro de pessoas, tela de
  proventos, catálogo e cotação da B3, e sugestão de viagem, porque a tabela de destinos está em reais e parte do Brasil.
  Investimento fica em `exterior`, `renda_fixa`, `fundo`, `previdencia` e `outro`, com valor informado. Os agentes de
  investimentos e de mercado não buscam nada de B3 para essa família.
- **`useMoney` e `getMoney` são como a tela formata.** A moeda vem do layout raiz, lida uma vez por requisição por
  `familyCurrency`, e cai em real sem sessão ou sem banco. `formatAmount` fica para quem sabe a moeda por outro caminho: texto
  dos agentes e a landing. Um teste procura `R$` escrito à mão e formatador direto nas telas da família.
- **Moeda no catálogo por marca, não por variável.** `¤` é o símbolo, `¤¤` o nome no plural e `¤¤¤` as outras duas, trocados em
  `messagesFor(locale, currency)`, ao montar o catálogo. Assim dezenas de rótulos "Valor (¤)" não pedem um parâmetro em cada
  tela, e em real sai o texto de sempre.
- **Agentes gravam valor cru com a moeda:** `{ money, currency }`, com `currency` só fora do real, para linha em real ficar
  igual. Texto de reserva em português também sai na moeda da família.
- **Assistente e dicas.** A moeda e o aviso de que INSS, FGTS, CLT, IR, FGC, previdência brasileira e B3 não se aplicam vão em
  `turnContext`, nunca em `SYSTEM_PROMPT`. `buscar_conhecimento` avisa que a base é do Brasil. O verificador de números já
  aceitava US$ e €.

## Fora do escopo por enquanto

Tradução dos Termos e da Privacidade. Nomes e fontes dos destinos de viagem, que vêm de uma tabela global sem campo por idioma. Troca dos usos de
`formatBRL` fora das telas traduzidas. Painel de administração, que segue só em português.

## Riscos aceitos

- **Trava da moeda cobre o que o pedido listou.** Bem, previsão, renda e plano de aposentadoria não travam: quem cadastra só
  isso e troca a moeda vê o mesmo número na moeda nova. Não há conversão.
- **Corrida na troca de moeda.** A trava é conferida na action, sem constraint no banco: um lançamento gravado no mesmo instante
  da troca passa.
- **Leitura de dívida por arquivo** continua dizendo ao modelo que o saldo está em reais, porque o número é copiado como está.
- **Uma consulta a mais por requisição** para quem está logado: `familyCurrency`, no layout raiz e no catálogo.
- **Lançamento previsto com data futura** fica com a última cotação na criação e não muda ao ser confirmado. A conta na
  moeda original é exata; os reais podem diferir da cotação do dia em que o pagamento aconteceu. Editar a data recalcula.
- **Reais de um mês antigo não acompanham o câmbio**, e o saldo em reais, sim. Por isso a soma dos lançamentos em reais não
  fecha com o saldo de conta estrangeira. A tela de Contas explica em uma linha.

- **Dica da madrugada num idioma só.** Na família com duas pessoas de idiomas diferentes, quem não definiu o aceite lê a dica
  no idioma de quem definiu: o texto é do modelo, e escrevê-la duas vezes custaria o dobro.
- **Descrição igual à do sistema.** Quem digitar "Meta: Carro (1/10)" ou "Férias · Empresa" verá traduzido: o texto não diz
  quem o escreveu, e não há coluna de origem. Só acontece com o texto exato.
- **Conta vence cookie.** Quem tem idioma na conta e escolhe outro na tela de entrar volta ao da conta ao entrar.
- **Landing dinâmica.** Deixou de ser pré-renderizada e passa a ser montada a cada visita. É rápida e sem banco para quem
  não entrou, mas é mais trabalho no servidor do que antes. Voltar a pré-renderizar pede tirar o layout raiz único, porque é
  ele que lê o cookie para `<html lang>`. Isso significa um layout raiz por área, `global-not-found`, que é experimental no
  Next 16, e mover todas as rotas para grupos, além de o 404 do painel do serviço depender do layout raiz atual. É caro
  demais para o ganho.
- **Nome e fonte de destino sugerido continuam em português.** A tabela global não tem campo por idioma.
- **Formato pelo idioma, não pelo país.** `en` usa data americana e `es` usa o espanhol geral do Intl. Quem precisar de
  outro formato vai pedir variante; o desenho aceita (`en-GB`, `es-MX`), mas não há seletor para isso.
- **Campos de valor seguem no formato brasileiro** nas telas ainda não traduzidas. As do dia a dia já usam `parseMoney`.
- **Linha gravada antes da Fase 3 continua em português**: sugestões e relatórios de importação. Notificações antigas
  traduzem, porque `data` já trazia os valores. O plano da meta alcança na noite seguinte.
