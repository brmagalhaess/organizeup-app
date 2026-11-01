# Especificação — vários idiomas e várias moedas

Pedido do fundador em 2026-11-01. Decisões duráveis vão para o ADR-0020.

Tamanho medido em 2026-11-01: 43 telas, 129 arquivos `.tsx`, `formatBRL` em 46 arquivos (265 usos), `pt-BR` escrito
no código em 35 lugares, e regras que só existem no Brasil: CLT, INSS, IR, FGC, B3 e proventos.

## Decisões

- **Idiomas:** português do Brasil (padrão), inglês e espanhol.
- **Moedas:** real (padrão), dólar e euro.
- **Idioma é da pessoa; moeda principal é da família.** Na mesma família, cada pessoa escolhe o idioma, e todos
  veem os totais na mesma moeda.
- **Dinheiro continua em `numeric(14,2)` com `packages/domain`.** Nunca `number`. Nada é reescrito.
- **`transactions.amount` é sempre em reais**, em qualquer conta. Lançamento em conta estrangeira guarda ao lado o que foi
  digitado e a cotação congelada (`original_amount`, `original_currency`, `fx_rate`). Resumos, planos, agentes, IA e
  calendário somam essa coluna em cerca de 50 arquivos: guardar dólar nela obrigaria a converter em todos eles, e um
  esquecido somaria dólar com real em silêncio. Por isso a primeira versão desta especificação, com cada valor na moeda da
  conta, mudou (ADR-0020).

## Idiomas

- `next-intl`, sem prefixo de idioma no endereço do app. A escolha fica na conta, com cookie para quem não entrou. A
  landing ganha `/en` e `/es`, por causa de busca.
- Textos em `apps/web/messages/{pt-BR,en,es}.json`. Teste no `pnpm check`: as três listas têm as mesmas chaves.
- Datas, números e meses vêm de `Intl`, com o idioma da pessoa.
- Assistente e dicas respondem no idioma da pessoa. Dicas, relatórios e sugestões dos agentes passam a guardar chave e
  valores, e não frase pronta: é a parte mais trabalhosa, porque hoje o agente grava o texto em português.
- E-mails no idioma de quem recebe.
- **Termos e Privacidade:** em inglês e espanhol são tradução de cortesia, e vale o português, até haver revisão
  jurídica de cada país.

## Moedas

- `accounts.currency` (BRL, USD, EUR), padrão BRL. Só muda em conta sem movimento. `opening_balance` fica na moeda da
  conta.
- Cartão, dívida, meta e investimento seguem só em real. Pagos com conta estrangeira, convertem pela data.
- `household_settings.currency` já existe: passa a ser a moeda principal na Fase 6.
- `market_fx`, global: PTAX de venda por dia, no job de mercado, com histórico de 10 anos na primeira vez. Sem cotação no
  dia, vale a última anterior; data futura usa a última. Depois de gravada, não muda.
- Lançamento converte com a cotação da data dele, congelada; editar valor ou data recalcula. Saldo e patrimônio convertem
  com a última. Toda tela com conversão diz "convertido pela cotação de <data>".
- Saldo de conta estrangeira, na moeda dela: `opening_balance` + soma de `coalesce(original_amount, amount)` com sinal +
  transferências.
- `formatMoney(value, currency, locale)` substitui `formatBRL`; `parseBRL` passa a seguir o idioma.
- Transferência entre contas de moedas diferentes guarda o valor que saiu (`amount`), o que entrou (`to_amount`) e a taxa
  real (`fx_rate`). A diferença de câmbio não é gasto nem receita.
- Extrato de conta estrangeira está na moeda da conta: converte na data de cada linha.
- Conta em dólar ou euro ainda não aceita conta que se repete (`cashflow_plans` só guarda reais).

## Limite que precisa ficar claro

Moeda principal fora do real muda a promessa do produto. INSS, CLT, IR, FGC, tesouro e proventos da B3 só valem no
Brasil. Família com moeda principal dólar ou euro não vê nem recebe cálculo baseado nessas regras: aposentadoria fica
só com carteira e renda alvo. A base de conhecimento continua brasileira e o assistente avisa isso.

## Fases

1. **Base de idiomas:** `next-intl`, escolha na conta, menu, painel, login e cadastro nos três idiomas.
2. **Telas:** demais telas por lote, um PR por área.
3. **Agentes e e-mails:** chave e valores em vez de frase pronta.
4. **Moeda na tela:** `formatMoney` em todo lugar, ainda só real, sem mudar nada que a família vê.
5. **Conta em outra moeda:** `market_fx`, conversão nos totais, transferência entre moedas.
6. **Moeda principal fora do real:** esconder as regras brasileiras.

Cada fase é publicada e conferida antes da próxima.
