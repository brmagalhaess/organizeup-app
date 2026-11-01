# Especificação — vários idiomas e várias moedas

Pedido do fundador em 2026-11-01. Decisões duráveis vão para o ADR-0019.

Tamanho medido em 2026-11-01: 43 telas, 129 arquivos `.tsx`, `formatBRL` em 46 arquivos (265 usos), `pt-BR` escrito
no código em 35 lugares, e regras que só existem no Brasil: CLT, INSS, IR, FGC, B3 e proventos.

## Decisões

- **Idiomas:** português do Brasil (padrão), inglês e espanhol.
- **Moedas:** real (padrão), dólar e euro.
- **Idioma é da pessoa; moeda principal é da família.** Na mesma família, cada pessoa escolhe o idioma, e todos
  veem os totais na mesma moeda.
- **Dinheiro continua em `numeric(14,2)` com `packages/domain`.** Nunca `number`. Cada valor guardado fica na moeda da
  conta: nada é reescrito.

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

- `accounts.currency` (BRL, USD, EUR), padrão BRL. Lançamentos, cartões e dívidas herdam a moeda da conta.
- `household_settings.currency` já existe: passa a ser a moeda principal.
- `market_fx`, global: cotação por dia, da PTAX do Banco Central, no job de mercado, com o dia anterior quando não há
  fechamento. Depois de gravada, não muda.
- Totais convertem com a cotação da data de cada lançamento; saldo e patrimônio, com a de hoje. Toda tela com conversão
  diz "convertido pela cotação de <data>".
- `formatMoney(value, currency, locale)` substitui `formatBRL`; `parseBRL` passa a seguir o idioma.
- Transferência entre contas de moedas diferentes guarda o valor que saiu e o que entrou.

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
