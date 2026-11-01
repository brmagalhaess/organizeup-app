# ADR-0020 — Idiomas e moedas

Status: aceito (2026-11-01).

Pedido do fundador. Soma ao ADR-0004 (dinheiro), ao ADR-0015 (agentes, que seguem gravando texto em português até a
Fase 3) e ao ADR-0018 (o assistente passa a responder no idioma da pessoa). A especificação e as fases estão em
`docs/specs/idiomas-e-moedas.md`. Este ADR registra o que já vale; a parte de moeda em conta nasce na Fase 5.

## Decisão

### O que é de quem

- **Idioma é da pessoa; moeda principal é da família.** Na mesma família, cada um escolhe o idioma, e todos veem os
  totais na mesma moeda.
- **Idiomas:** português do Brasil, inglês e espanhol. **pt-BR é sempre o padrão e o fallback.**
- **Moedas:** real, dólar e euro. Real é o padrão. Cada valor guardado fica na moeda da conta, em `numeric(14,2)`, com
  `packages/domain`. Nada é reescrito.

### `next-intl`, sem prefixo no endereço

- **Por que `next-intl`:** é a biblioteca feita para o App Router: a mesma API em componente de servidor e de navegador,
  `getTranslations` em server action e metadata, ICU com plural e marcas de texto rico, e chaves conferidas pelo
  TypeScript com `AppConfig`. Aceita Next.js 16 e funciona sem rotas por idioma, que é o que queremos no app. As
  alternativas não fecham: `react-i18next` pede ponte própria para o servidor, e o guia do Next.js só resolve o
  dicionário, sem plural, sem texto rico e sem as chaves tipadas. Versão fixa: 4.14.9. O navegador recebe só o catálogo do
  idioma atual.
- **Sem prefixo de idioma no app:** `/app/metas` é o mesmo endereço em todo idioma. Prefixo mudaria todos os links, os
  redirecionamentos e os e-mails já enviados, e não traz nada atrás de login. A landing ganha `/en` e `/es` por causa de
  busca, em fase própria.
- **Sem middleware.** O idioma é resolvido em `i18n/resolve.ts`, por requisição: **conta, depois cookie, depois
  `Accept-Language`, depois pt-BR**. O layout raiz lê cookie, então nenhuma tela é mais pré-renderizada no build: é o
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
  ainda não há moeda em conta (`R$1,234.56` em inglês, `1234,56 R$` em espanhol).
- **Validação no servidor** continua com a mensagem em português nos esquemas, que telas não traduzidas usam. A action
  de tela traduzida troca a mensagem pelo campo. Some quando todas as telas forem traduzidas.
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

## Fora do escopo por enquanto

Fases 2, 3, 5 e 6 da especificação: demais telas, agentes e e-mails com chave e valores, moeda em conta, `market_fx`,
conversão, moeda principal fora do real. Landing em `/en` e `/es`. Tradução dos Termos e da Privacidade. Troca dos usos de
`formatBRL` fora das telas traduzidas. Painel de administração, que segue só em português.

## Riscos aceitos

- **Telas parcialmente em português** para quem escolhe inglês ou espanhol, até a Fase 2: cadastro leva a "Criar família",
  e o painel mostra dicas, sugestões, categorias padrão e avisos do serviço como foram gravados.
- **Conta vence cookie.** Quem tem idioma na conta e escolhe outro na tela de entrar volta ao da conta ao entrar.
- **Landing dinâmica.** Deixou de ser pré-renderizada e passa a ser montada a cada visita. É rápida e sem banco para quem
  não entrou, mas é mais trabalho no servidor do que antes.
- **Formato pelo idioma, não pelo país.** `en` usa data americana e `es` usa o espanhol geral do Intl. Quem precisar de
  outro formato vai pedir variante; o desenho aceita (`en-GB`, `es-MX`), mas não há seletor para isso.
- **Campos de valor seguem no formato brasileiro** até as telas com digitação de dinheiro serem traduzidas, com `parseMoney`.
