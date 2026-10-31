# Especificação — assistente com IA e autonomia

Pedido do fundador em 2026-10-31: o mais moderno e autônomo possível. O sistema deve resolver os
próprios problemas e subir para `main`, e deve resolver o problema financeiro da família para ela se
aposentar: não só dar dicas, mas sugerir e organizar, em metas, lançamentos, planos, viagens e
aposentadoria. Substitui, na Fase 3, a decisão "sem IA" dos ADR-0013 e ADR-0015. Decisões duráveis
vão para o ADR-0018.

## 0. Princípios

1. **As contas continuam em `packages/domain`.** A IA decide o que olhar, explica, prioriza e propõe;
   ela nunca calcula dinheiro de cabeça. Todo número que aparece vem de uma ferramenta.
2. **Regra 7 continua valendo.** Dado derivado o sistema muda sozinho, com Desfazer. Dado informado
   muda por sugestão aceita, exceto o que a família autorizar no nível de autonomia (§4). O sistema não
   tem acesso a contas bancárias e não move dinheiro.
3. **Consentimento antes de ligar.** Enviar dados ao provedor de IA é transferência internacional a um
   operador. Cada família aceita uma vez (`household_settings.ai_consent_at`, com versão da Política).
   Sem aceite, tudo funciona como hoje, por regras.
4. **Sem identificar a pessoa.** Nomes, e-mail, CPF e identificadores não vão ao modelo: pessoas
   viram "titular", "cônjuge", "filho 1". Descrição de lançamento vai, porque é o que se quer entender.
5. **Texto de extrato, anexo e nome de meta é dado, nunca instrução** (injeção), e a resposta passa
   por verificação antes de chegar à família.
6. **CVM:** nada de recomendação individual de compra ou venda de ativo. Fala de classes, metas e
   conceitos, com aviso nas telas de investimento.
7. **Teto de gasto duro**, independente de plano, com desligamento automático.

## 1. Pacote `packages/ai`

- SDK oficial `@anthropic-ai/sdk`. Modelo `claude-opus-5-5`, `output_config.effort` por rota
  (chat `medium`, rotina noturna `high`, classificação `low`), `fallbacks: "default"` com o beta da
  skill `claude-api`. Sem `thinking` desligado e sem `tool_choice` forçado: usar `auto` com
  `strict: true` ou `output_config.format`. Ler a skill antes de escrever.
- Cache de prompt: instruções e ferramentas estáveis primeiro, dado volátil depois. Conferir
  `cache_read_input_tokens`.
- Chamada ao modelo **nunca** dentro de `withHousehold`. Cada ferramenta abre sua transação curta.
- `ai_usage` (RLS): dia, rota, tokens de entrada, saída, cache, custo estimado. `ops.ai_stats`: só
  somas. Variáveis: `ANTHROPIC_API_KEY`, `AI_MONTHLY_BUDGET_USD`, `AI_FAMILY_DAILY_TOKENS`. Flag `ai`
  em `ops.feature_flags` desliga tudo; ao atingir o teto, desliga sozinho e avisa no admin.

## 2. Ferramentas (padrão MCP)

Um registro único em `packages/ai/tools`, com nome, descrição, esquema zod e função
`(ctx, input) => result`, usado pelos dois lados:

- **Leitura da família:** resumo do mês, lançamentos com filtro, categorias, renda, reserva, dívidas,
  carteira, proventos, plano de aposentadoria, metas, viagens, calendário, relatórios do dia.
- **Escrita da família:** criar sugestão, reorganizar categoria, ajustar plano de meta, criar meta ou
  viagem em rascunho, registrar lembrete, salvar memória, cada uma respeitando §4.
- **Simulação, sem gravar:** "e se guardar mais 500?", "e se antecipar a aposentadoria?", usando
  `packages/domain`.

Exposição real por **MCP**:

- `/api/mcp/ops` para a equipe do Paperclip, com o token da Ops API e sem dado de família: contexto,
  deploys, erros, relatórios e memória.
- Família acessando pelo próprio Claude fica para depois: exige OAuth por pessoa.

## 3. Conhecimento (RAG) e memória

- `knowledge_chunks` global: regras de INSS, IR, FGTS, previdência, educação financeira, cada trecho
  com fonte e data. Só entra conteúdo com fonte; revisão anual pelo SRE.
- `household_memories` (RLS): fatos e preferências da família, com origem, confiança, validade e
  substituição, mais a tela "O que o assistente sabe" para ver, corrigir e apagar. Entra em exportar e
  apagar conta.
- Busca híbrida: `tsvector` em português agora; coluna `embedding` do pgvector, nula, pronta para ligar
  quando houver chave de embeddings (a Anthropic não oferece esse serviço). Enquanto isso, as
  ferramentas estruturadas são a fonte principal: dado financeiro não se busca por semelhança.

## 4. Autonomia por família

`household_settings.ai_autonomy`, escolhido na ativação e editável:

| Nível     | O que faz sozinho                                                                                                                       |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Sugerir   | Só dicas e sugestões.                                                                                                                   |
| Organizar | Padrão. Categoriza, junta categorias, ajusta plano de metas, cria lembretes, tudo com Desfazer.                                         |
| Completo  | Também cria meta e viagem em rascunho e ajusta a divisão do que sobra dentro de limites. Mudar valor informado continua sendo sugestão. |

Cada ação guarda motivo, estado anterior e origem. Limite de ações por dia. Falha de verificação
rebaixa para sugestão.

## 5. Orquestração noturna

Depois dos cinco agentes de regras e da atualização de mercado:

1. **Orquestrador** recebe os relatórios do dia e decide qual especialista olhar.
2. **Especialistas** (Finanças, Aposentadoria, Investimentos, Metas, Viagens) como persona + conjunto
   de ferramentas no mesmo runtime, com a API de Batches (metade do preço) quando couber.
3. **Verificador** determinístico: todo número citado existe no retorno das ferramentas, sem ativo
   recomendado, sem nome de pessoa, sem instrução vinda de dado. Reprovou, descarta e registra.
4. **Grava:** `household_insights` e sugestões, e aplica o que o nível de autonomia permite.

Roda só para famílias com consentimento e ativas. Idempotente por dia, uma família por vez, sem
transação aberta durante a chamada ao modelo.

## 6. O que a família vê

- **Dicas em cada tela:** `household_insights` (tela, título, texto, ação, prioridade, validade),
  mostradas em painel, lançamentos, calendário, metas, viagens, investimentos, proventos, aposentadoria,
  reserva e dívidas, com "Fazer agora", "Entendi" e "Por quê?".
- **Plano do mês:** uma tela "Seu plano" com as 3 ações que mais aproximam a família da aposentadoria,
  com quanto cada uma antecipa em meses ou anos, calculado por `packages/domain`.
- **Conversa:** botão do assistente em todas as telas, resposta em tempo real, ferramentas visíveis
  ("olhei seus lançamentos de outubro"), botões de ação nas respostas e simulações.
- **Ativação:** explica o que é enviado, para quem e por quê; aceite e nível de autonomia.

## 7. Autonomia da engenharia

- **Erros visíveis:** `instrumentation` grava em `ops.diagnostics` a impressão digital do erro, rota,
  contagem e commit, sem corpo nem dado pessoal, com `/api/ops/diagnostics`. Sem isso a equipe só vê
  fora do ar, não erro de tela.
- **Rotina:** Tech Lead lê os erros e abre reparo; SRE reverte sozinho se o deploy piorar a taxa de erro.
- **Publicação:** o Revisor mescla no `main`; só migração destrutiva espera o fundador.
- **Novos agentes no Paperclip:** Produto (lê métricas sem dado de família e propõe melhorias),
  Segurança (revisa dependências e permissões toda semana) e Documentação. Contratação com clique
  do fundador.

## 8. Qualidade

- `packages/ai/evals`: casos fixos com dados fictícios para categorização, dica, recusa de recomendação
  de ativo, injeção em descrição de extrato, número inventado, privacidade. Roda sob demanda: custa
  dinheiro e fica fora do `pnpm check`.
- Teste de RLS para cada tabela nova; testes do verificador e das ferramentas sem chamar o modelo.

## 9. Fases de entrega

1. `packages/ai`, usage, teto, consentimento, ferramentas de leitura, conversa.
2. Dicas por tela e rotina noturna com verificador.
3. Ferramentas de escrita, níveis de autonomia, Plano do mês.
4. Memória, conhecimento, MCP da equipe, diagnósticos e novos agentes.

Cada fase é publicada e conferida antes da próxima.
