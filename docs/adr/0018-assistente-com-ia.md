# ADR-0018 — Assistente com IA

Status: aceito (2026-10-31). Fase 1 de `docs/specs/assistente-ia.md`.

Substitui a parte "sem IA" do ADR-0013 (regras e memória, sem modelo) e do ADR-0015 (sem modelo de IA nos
agentes). Os cinco agentes diários continuam por regras; a IA entra ao lado deles, começando pela conversa. A
etapa de IA do agente de categorias está em "Categorias com IA".

## Decisão

### Fronteira

- **Pacote `packages/ai`** (`@organizeup/ai`), com `@anthropic-ai/sdk` em versão exata. Modelo
  `claude-haiku-5-5`, por decisão de custo do fundador em 2026-11-01 (começou em `claude-opus-5-5`). Esforço por
  rota (`medium` na conversa), pensamento sempre ligado, `tool_choice` `auto` com `strict: true`. Esse modelo não
  tem `fallbacks` no servidor: uma recusa vira o texto de recusa na tela.
- **As contas continuam em `packages/domain`.** A IA escolhe o que olhar e explica; nunca calcula dinheiro.
- **O modelo nunca é chamado dentro de `withHousehold`.** Cada passo abre e fecha a própria transação. O loop é
  manual, e não o tool runner, porque precisa conferir consentimento e teto antes de cada chamada, gravar o uso
  de cada resposta e parar pelo botão da tela.
- **O endereço do modelo é fixo** (`api.anthropic.com`), ignorando `ANTHROPIC_BASE_URL`: dado de família não muda
  de destino por variável de ambiente. A única exceção é `AI_TEST_BASE_URL`, que só vale fora de produção e em
  endereço desta máquina, para o e2e.
- **Leituras compartilhadas** (`loadCommitments`, `currentDividendPlan`, `calendarMonth`) foram para
  `packages/agents`: a tela e o assistente precisam dar o mesmo número.

### Consentimento

- **Por família, uma vez.** `household_settings.ai_consent_at`, com `ai_consent_version` (a `LEGAL_VERSION` aceita)
  e `ai_consent_by`. Só `owner` e `adult` ativam, e o servidor confere antes de toda chamada. Mudar a Política
  depois não pede novo aceite; mudança material no que é enviado pede, com uma versão nova conferida aqui.
- **A base é o consentimento** (LGPD, art. 7º, I, e art. 33, VIII, para a transferência aos EUA). Desligar em
  Configurações limpa o aceite. As conversas ficam, e cada pessoa apaga as suas.
- **`ai_autonomy`** é gravado na ativação, mas só passa a valer com as ferramentas de escrita (Fase 3).

### Privacidade

- **Pessoas saem como "titular", "cônjuge", "filho 1".** Nome, e-mail e CPF não saem: toda saída de ferramenta e
  toda pergunta passam por um filtro central com os nomes das pessoas, das contas de membros e da família. Parte
  de nome que duas pessoas têm (o sobrenome) vira "família". O filtro não acha nome de terceiro numa descrição de
  extrato, e a Política diz isso.
- **Texto livre é dado, nunca instrução.** Descrição, nome de meta, conta, dívida, viagem e evento vão em
  `{"dado_nao_confiavel": ...}`, dentro de `<dados_da_ferramenta>`, com `<` escapado para um extrato não conseguir
  fechar a marca. As instruções repetem a regra.
- **Sem ids internos** no que vai ao modelo: filtros são por nome.
- **Cada conversa é de uma pessoa, inclusive dentro da família.** O RLS confere `household_id` e `app_user_id()`
  (função nova), e a FK de `assistant_messages` é `(household_id, user_id, thread_id)`, então nem a checagem de
  FK, que ignora RLS, deixa uma mensagem entrar na conversa de outra pessoa. Mensagem não tem UPDATE nem DELETE:
  some com a conversa. Exportar traz só as conversas de quem exportou. Apagar a conta leva as conversas.
- **`ai_usage` e `ops.ai_stats` têm só contagens.** Rota e modelo têm `CHECK` de formato: texto não cabe. No log,
  só código de erro.

### Histórico

Para o modelo vai só o texto das mensagens anteriores, sem resultados de ferramenta nem blocos de pensamento. Isso
mantém dado pessoal fora de conversas antigas, evita a checagem de histórico editado do pensamento preservado e
gasta menos. Se precisar de um número antigo, o modelo consulta de novo. O preço é reler ferramentas a cada
pergunta nova: o cache cobre instruções e ferramentas, que ficam em ordem fixa, e a data do dia vai numa mensagem
`system` depois da pergunta.

### Teto

- **`AI_MONTHLY_BUDGET_USD`** (padrão 50) vale para o serviço inteiro, e **`AI_FAMILY_DAILY_TOKENS`** (padrão
  200.000) por família, somando entrada, saída e escrita de cache. Leitura de cache fica fora: custa um vigésimo.
- **O custo vem do `usage` de cada resposta**, por tentativa quando há fallback, com preços em constantes. Modelo
  desconhecido custa o preço mais alto da tabela. Parar no meio estima a saída pelo que chegou.
- **O teto mensal é calculado, não gravado.** `ou_app` não escreve em `ops.feature_flags`, e deve continuar assim
  (ADR-0016). A soma de `ops.ai_stats` é conferida antes de cada chamada: bateu, para sozinho; virou o mês ou o
  teto subiu, volta. O painel alerta a partir de 80% e ao bater.
- **Chave `ai` em `ops.feature_flags`**: é a única com sentido invertido. Linha ausente é ligado, `enabled = false`
  é desligado pelo painel em Controles.
- **Falhar ao gravar o uso encerra o turno**: sem registro, o teto não vale.

### Verificação na conversa

A resposta sai em tempo real, então a conferência acontece no fim: valor em reais que não apareceu nas ferramentas
nem na pergunta ganha um aviso para conferir, e fala de investimento ganha o aviso da CVM. Nada é apagado da tela.
O verificador que reprova antes de gravar é o da rotina noturna (Fase 2). Recusa do modelo (`stop_reason:
"refusal"`) descarta o texto parcial e não roda ferramenta.

### Quem conversa

Só `owner` e `adult`. `child` e `viewer` veem a explicação. Modo manutenção bloqueia, porque o contexto vira só
leitura e o RLS recusaria gravar a conversa.

### Memória e conhecimento (Fase 4)

- **Busca por texto, sem embeddings.** A Anthropic não oferece serviço de embeddings, e contratar outro fornecedor
  mandaria texto a mais um operador para uma base de 15 trechos. `knowledge_chunks.search` é `tsvector` em
  português, com `websearch_to_tsquery`, que aceita qualquer texto como parâmetro, e `ts_rank`. Os termos da
  pergunta entram com OU, porque com E uma pergunta em linguagem natural quase nunca acha nada. `sem_acento()` faz
  "previdencia" achar "previdência". A coluna `embedding` ficou de fora: nem o Postgres embutido dos testes nem o
  `pnpm db:local` têm pgvector, e não há como confirmar o de produção daqui. Entra por migração nova se um dia
  houver chave de embeddings.
- **A base é código.** Os trechos ficam em `packages/db/src/knowledge-seed.ts`, e o migrador, com a credencial do
  dono, grava pelo `slug` e tira o que saiu da lista. Assim a revisão anual do SRE é um PR comum, sem migração nova
  a cada ano. Na aplicação, todos leem, só `ou_worker` poderia gravar e ninguém apaga, como no mercado.
- **Só entra o que foi conferido na fonte oficial**, com endereço https, data de revisão e, se o valor muda todo
  ano, o ano no texto. O teste do seed recusa domínio fora de `.gov.br` e do FGC.
- **Memória não é sugestão.** `salvar_memoria` grava direto, fora da regra 7: o que entra não é valor nem data da
  família, é uma anotação que a pessoa pediu ou aceitou, visível e apagável em Configurações. Por isso a ferramenta
  recusa dinheiro: número vem das ferramentas, e uma anotação velha não pode competir com o saldo de hoje. Também
  recusa texto com jeito de ordem ou link, para uma injeção não virar instrução que dura entre conversas.
- **Memória parecida substitui.** Compara os radicais de memórias vigentes do mesmo tipo e substitui a partir de
  60% em comum, com `superseded_by`. Apagar a nova leva as antigas, em cascata, para o texto apagado não sobreviver
  numa versão anterior.
- **No contexto, nunca nas instruções.** Até 20 memórias vão em `turnContext`, marcadas como
  `dado_nao_confiavel` e passando por `privacy.scrub` de novo, porque um nome pode ter sido cadastrado depois.
  `SYSTEM_PROMPT` continua fixo. A madrugada não recebe memória e não anota, mas pode consultar a base.
- **Sem aceite novo.** Memória é o que a pessoa já disse na conversa, para o mesmo operador e a mesma finalidade.
  A Política foi atualizada, e `INSIGHTS_CONSENT_VERSION` não muda.

### Categorias com IA

Regras e memória não resolvem extrato que caiu em categoria genérica, e isso distorce a projeção de aposentadoria.

- **Etapa dentro da rodada diária, não job próprio.** `categorias_ia` roda família a família, logo depois de
  `categorias` e antes da aposentadoria. Uma fila separada não garantiria essa ordem. Acordar `categorias` traz a
  etapa junto; ela tem interruptor próprio no painel. A chamada fica fora de `withHousehold`.
- **Rota `categorias`:** esforço `low`, saída em `output_config.format`, sem `tools` nem `tool_choice`, porque a API
  recusa `tool_choice` em chamada sem ferramentas. Instruções próprias, sem as da conversa. Portão igual ao das dicas,
  com `INSIGHTS_CONSENT_VERSION`: categorias usam dados e operador que o aceite da madrugada já cobre. O uso gravado da
  rota no dia é a marca de "já rodou", então não há tabela nova.
- **O que vai:** até 80 estabelecimentos por noite, dos maiores valores para os menores, de todo o histórico, não só 90
  dias, porque a projeção olha mais longe. A chave é `merchantKey`, a mesma da memória. Vão descrição limpa, tipo,
  quantidade, valor médio e nomes de categorias. A limpeza roda antes de normalizar, porque normalizar desmonta e-mail e
  CPF, e de novo depois, para pegar nome colado em número. Categoria genérica ou de sistema não aparece como destino.
- **O que não entra:** categorias de meta, aporte, cartão, dívida e transferência, como origem e como destino, e
  estabelecimento com sugestão desfeita ou ignorada há menos de 30 dias. Sem isso, o que já foi decidido
  ficaria no topo toda noite e o resto do histórico nunca seria visto.
- **O modelo só opina.** `planCategoryMoves`, em `packages/domain`, valida cada resposta: categoria existente do
  mesmo tipo, nome novo curto e sem nome de pessoa, no máximo 5 novos por noite, e quase-duplicata funde na existente.
- **Regra 7, com a decisão do fundador em 2026-11-01** ("O agente de categoria não precisa perguntar se é para mudar a
  categoria, ele deve mudar sem precisar de aprovação. Não precisa ir como sugestão, somente mude."; ver ADR-0015).
  Confiança média ou alta aplica sozinha o que está em categoria genérica, seja qual for a origem, inclusive `familia`,
  e o que ficou `revisar`, com Desfazer e notificação, e grava `category_memory` com `source = 'agente'`. Nada vira
  sugestão pendente. O nível **Sugerir** também muda direto, porque a decisão vale em todo nível. Sem o aceite do
  assistente, a etapa de IA não roda, e só a parte por regras muda. O limite de 5 ações por dia da §4 vale para o
  assistente da conversa, não para esta etapa, que trabalha por lote.
- **Confiança baixa** não muda nem pergunta: vira a mesma marca `sem_pista`, e o estabelecimento é avaliado de novo em
  30 dias.
- **`sugerir_categoria`** segue o mesmo critério, em qualquer nível: muda na hora o que está em categoria genérica ou
  `revisar`, com notificação e Desfazer, dentro do limite de 5 por dia. Lançamento em categoria específica não muda nem
  vira sugestão, mesmo que a pessoa peça, e estabelecimento desfeito também não: ela troca direto no lançamento. As
  outras ferramentas de escrita continuam só criando sugestão.
- **Desfeito bloqueia o estabelecimento, não só o destino.** O modelo não é consultado de novo sobre ele, e as regras
  também não o movem. Categoria criada pela mudança desfeita é arquivada se ficou sem uso.
- **Sem resposta aproveitável** (o modelo não soube, ou a resposta foi recusada) vira marca `ignorada` com chave
  `sem_pista`, sem nada na tela, e o estabelecimento fica de fora por 30 dias.
- **Relatório:** a parte da IA vai em `data.ia` do relatório `categorias` do dia e sobrevive a uma nova rodada das regras.

## Pronto para as próximas fases

Ferramenta de escrita entra em `packages/ai/src/tools` com `kind: "escrita"` e só cria sugestão (regra 7); rota nova
é uma constante `AiRoute` com seu esforço e seus tipos de ferramenta. Quando o worker chamar o modelo, `ou_worker`
precisa do grant de escrita em `ops.ai_stats`, e a integração passa a valer nos dois serviços.

## Riscos aceitos

- **O teto duro pode passar um pouco.** A conferência é antes de cada chamada, então pedidos simultâneos perto do
  limite passam juntos. Excede em no máximo uma chamada por conversa aberta.
- **Descrição de extrato sai do Brasil.** É o que se quer entender, e pode citar terceiros. A Política diz isso.
- **Nome comum vira rótulo por engano.** Uma "Padaria Rosa" numa família com uma Rosa vira "Padaria titular". É o
  erro menos grave.
- **O modelo pode errar.** A conferência de valores aceita 5% de diferença, para deixar passar arredondamento, e
  não confere datas nem percentuais. A tela pede para conferir.
- **Memória parecida é um palpite.** A comparação é por palavras: "tem dois carros" e "não tem dois carros" são a
  mesma memória, e a última dita vale, o que serve. Duas coisas diferentes com as mesmas palavras se substituem, e
  a família vê o resultado em Configurações. A busca por texto também não acha sinônimo que não esteja no trecho.
- **Nome de terceiro numa memória.** O filtro só conhece os nomes da família, como nas descrições de extrato.
- **Texto legal.** A Política e a ativação descrevem retenção curta e não treinamento conforme os termos
  comerciais da Anthropic. O fundador confere com o contrato vigente antes de ligar a chave.
