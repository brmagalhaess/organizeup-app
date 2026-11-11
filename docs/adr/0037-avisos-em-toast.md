# ADR-0037 — Avisos em toast

Status: aceito (2026-11-10)

## Contexto

Cada tela mostrava o resultado das ações do seu jeito: `FormMessage` ao lado do botão, em vermelho
mesmo para sucesso quando o tom não era passado, e nada aparecia quando o painel lateral fechava
logo depois de salvar. A pessoa salvava e não tinha certeza se deu certo.

## Decisão

- Um provedor só, `components/toast.tsx`, montado no layout raiz. `useToast().show({ tone, text, title })`
  serve para qualquer tela do navegador; sem provedor (testes) devolve `null` e o texto fica inline.
- `FormMessage` continua sendo a porta de entrada dos formulários: **erro fica no lugar**, perto do botão,
  com `role="alert"`; **sucesso vira toast** (`tone="ok"`). Quem precisa do texto de sucesso na tela
  passa `inline`. Dois envios seguidos com a mesma frase avisam duas vezes: o componente observa o fim do
  envio com `useFormStatus`.
- Visual: cartão com os tokens do tema (ADR-0003), faixa e ícone pelo tom (`success`, `error`,
  `warning`, `info`), botão de fechar, linha do tempo que esvazia; para com o mouse ou o foco em cima.
  Entra do topo, à direita no computador e em largura cheia no celular (a barra inferior fica livre).
  Sem animação com `prefers-reduced-motion`.
- Acessibilidade: cada aviso é `role="status"` (erro é `role="alert"`), com rótulo do tom para leitores
  de tela e botão com nome. A pilha fica na camada de topo (`popover="manual"`), acima de painéis e
  diálogos; no máximo três avisos, repetidos renovam em vez de duplicar. Erro fica 10 s, sucesso 5 s.
- Fila sem React em `lib/toast-queue.ts`, com teste unitário.

## Consequências

- Formulários que já passavam `tone="ok"` ganharam o toast sem mudar código. Os que mostravam sucesso
  sem tom continuam vermelhos até passarem o tom: ajustar quando a tela for tocada.
- Com um diálogo modal aberto, o toast aparece por cima, mas só volta a ser clicável quando ele fecha
  (`showModal` deixa o resto da página inerte). A maioria dos fluxos fecha o painel ao salvar.
