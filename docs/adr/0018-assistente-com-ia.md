# ADR-0018 — Assistente com IA

Status: aceito (2026-10-31). Fase 1 de `docs/specs/assistente-ia.md`.

Substitui a parte "sem IA" do ADR-0013 (regras e memória, sem modelo) e do ADR-0015 (sem modelo de IA nos
agentes). Os cinco agentes diários continuam por regras; a IA entra ao lado deles, começando pela conversa.

## Decisão

### Fronteira

- **Pacote `packages/ai`** (`@organizeup/ai`), com `@anthropic-ai/sdk` em versão exata. Modelo
  `claude-opus-5-5`, esforço por rota (`medium` na conversa), pensamento sempre ligado, `tool_choice` `auto`
  com `strict: true`, `fallbacks: "default"` com o beta `server-side-fallback-2026-07-01`.
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
- **Texto legal.** A Política e a ativação descrevem retenção curta e não treinamento conforme os termos
  comerciais da Anthropic. O fundador confere com o contrato vigente antes de ligar a chave.
