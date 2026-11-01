# ADR-0020 — Idiomas e moedas

Status: aceito (2026-11-01).

Pedido do fundador. Soma ao ADR-0004 (dinheiro), ao ADR-0015 (agentes, que seguem gravando texto em português até a
Fase 3) e ao ADR-0018 (o assistente passa a responder no idioma da pessoa). A especificação e as fases estão em
`docs/specs/idiomas-e-moedas.md`. Este ADR registra o que já vale. A moeda em conta nasceu na Fase 5; moeda principal fora do real
fica para a Fase 6.

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
- **Tela não traduzida aparece em português**, sem aviso na tela, marcada com `lang="pt-BR"` para o leitor de tela.
- **Datas e números das telas traduzidas** passam por `i18n/format.ts`, com `Intl` e o idioma da pessoa. Nunca `pt-BR`
  escrito no código de tela traduzida. Dinheiro nessas telas sai com o formato do idioma e continua em reais, porque
  a moeda principal segue sendo o real (`R$1,234.56` em inglês, `1234,56 R$` em espanhol).
- **Validação no servidor.** Esquema usado só por tela traduzida é montado com `t` e `locale`. Esquema dividido com tela
  ainda em português, como em `lib/onboarding.ts`, continua com a mensagem em português, e a action de tela traduzida
  troca a mensagem pelo campo. Isso some quando todas as telas forem traduzidas.
- **Termos e Privacidade continuam em português**, com aviso curto no idioma da pessoa dizendo que é a versão que vale.
  Tradução de cortesia só com revisão jurídica de cada país.

### Assistente

- **Idioma vai em `turnContext`, nunca em `SYSTEM_PROMPT`**, que é o prefixo do cache de prompt. Em português o contexto
  fica igual ao de sempre; em inglês e espanhol ele também sobrepõe o formato de valores das instruções.
- **A conferência determinística entende os dois formatos.** `uncheckedAmounts` lê `R$ 1,234.56` e `1.234,56 R$`, e
  `mentionsInvestment` conhece as palavras em inglês e espanhol. Sem isso, resposta em inglês daria aviso falso de número
  e deixaria de levar o aviso da CVM.
- **As dicas da madrugada ficam em português até a Fase 3**, quando agentes passam a guardar chave e valores. A base de
  conhecimento continua brasileira.

### Dinheiro

- **`formatMoney(value, currency, locale, style)`** é a função única; `formatBRL` e as variantes curtas delegam e dão o
  mesmo texto, conferido por propriedade contra os formatadores antigos.
- **Real sai com `narrowSymbol`**, porque o símbolo normal do real em espanhol é `BRL`. Dólar fica com `symbol`, porque o
  estreito tira o `US` e deixa `$` ambíguo em pt-BR.
- **`parseMoney(input, locale)` não adivinha.** Com os dois separadores, o último é o decimal. Com um só, a dúvida existe
  apenas em `1.234` e `1,234`, e aí vale o idioma. Nos outros casos só uma leitura é possível, e o que não fecha em
  nenhuma é erro. A mensagem de erro não repete o que foi digitado. `parseBRL` não muda.

### Contas em dólar e euro (Fase 5, 2026-11-01)

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

## Fora do escopo por enquanto

Fases 2, 3 e 6 da especificação: demais telas, agentes e e-mails com chave e valores, moeda principal fora do real. Tradução dos Termos e da Privacidade. Troca dos usos de
`formatBRL` fora das telas traduzidas. Painel de administração, que segue só em português.

## Riscos aceitos

- **Lançamento previsto com data futura** fica com a última cotação na criação e não muda ao ser confirmado. A conta na
  moeda original é exata; os reais podem diferir da cotação do dia em que o pagamento aconteceu. Editar a data recalcula.
- **Confirmar um compromisso em conta estrangeira sem nenhuma cotação** não faz nada e não dá mensagem, porque o botão não
  tem retorno. Só acontece antes da primeira rodada do job, ou em data anterior a 10 anos.
- **Reais de um mês antigo não acompanham o câmbio**, e o saldo em reais, sim. Por isso a soma dos lançamentos em reais não
  fecha com o saldo de conta estrangeira. A tela de Contas explica em uma linha.

- **Telas parcialmente em português** para quem escolhe inglês ou espanhol, até a Fase 2: cadastro leva a "Criar família",
  e o painel mostra dicas, sugestões, categorias padrão e avisos do serviço como foram gravados.
- **Conta vence cookie.** Quem tem idioma na conta e escolhe outro na tela de entrar volta ao da conta ao entrar.
- **Landing dinâmica.** Deixou de ser pré-renderizada e passa a ser montada a cada visita. É rápida e sem banco para quem
  não entrou, mas é mais trabalho no servidor do que antes. Voltar a pré-renderizar pede tirar o layout raiz único, porque é
  ele que lê o cookie para `<html lang>`. Isso significa um layout raiz por área, `global-not-found`, que é experimental no
  Next 16, e mover todas as rotas para grupos, além de o 404 do painel do serviço depender do layout raiz atual. É caro
  demais para o ganho.
- **Texto gravado continua em português até a Fase 3:** plano mensal da meta (`planNote`), descrição de aporte e resgate,
  categoria de aporte, evento `Viagem: <destino>` no calendário e sugestões dos agentes. Os nomes de destino sugeridos também.
- **`/app/completar` fica em português**, com os campos que divide com `/app/familia` já no idioma da pessoa.
- **Formato pelo idioma, não pelo país.** `en` usa data americana e `es` usa o espanhol geral do Intl. Quem precisar de
  outro formato vai pedir variante; o desenho aceita (`en-GB`, `es-MX`), mas não há seletor para isso.
- **Campos de valor seguem no formato brasileiro** nas telas ainda não traduzidas. As traduzidas usam `parseMoney` com o
  idioma da pessoa.
