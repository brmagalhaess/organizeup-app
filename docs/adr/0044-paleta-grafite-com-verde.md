# ADR-0044 — Paleta grafite com verde

Status: aceito (2026-11-16)

## Contexto

O sistema visual do ADR-0003 usava verde-pinho, areia (bege) e títulos em letra serifada. O fundador achou o
resultado pouco profissional e escolheu, entre três opções mostradas lado a lado, "grafite com verde": neutros
frios, verde só como cor de ação e marca, e títulos sem serifa.

## Decisão

- **Só os valores dos tokens mudam** (`apps/web/src/app/globals.css`); os nomes continuam (`pine`, `sand-*`,
  `peach`, `clay`, `night`, `stone`, `brand-*`), para não tocar em centenas de classes. Hoje `pine` e `night`
  são grafite, `sand-*` são cinzas frios, `peach` é o verde claro de destaque sobre fundo escuro e `clay` o
  verde de texto sobre fundo claro.
- **Títulos usam a mesma família do texto** (Inter): `--font-display` aponta para ela e a Fraunces deixa de
  ser carregada.
- **Botão principal** passa a ser o verde da marca (`brand-500`), com texto escuro no tema escuro para manter
  o contraste.
- **Marca**: quadro grafite, anel claro e seta verde; `icon.svg`, `apple-icon.png`, `favicon.ico`, a cor do
  navegador (`themeColor`) e as cores dos e-mails acompanham.
- **Cores de dado não mudam**: receita, despesa, séries e partes do patrimônio foram validadas para daltonismo
  e ficam como estão. Avisos (amarelo) e erro (vermelho) também.
- **Painel**: as seções passam a ficar em faixas de duas colunas com a mesma altura (gráfico e vencimentos;
  categorias e lançamentos do mês), com reserva e patrimônio entre elas, para não sobrar espaço vazio ao lado
  do cartão menor.

## Consequências

- Os nomes dos tokens de marca não descrevem mais a cor. Renomear fica para quando houver motivo maior.
- A foto e os textos da página inicial não mudaram.
