# ADR-0013 — Agente de categorização do extrato

Status: aceito (2026-10-30). A parte "sem modelo de IA" foi substituída pelo ADR-0018: a importação continua por regras
e memória, e a revisão diária ganhou a rota `categorias`.

## Decisão

- **Roda dentro do produto, não no Paperclip.** Quem categoriza precisa ler as descrições do extrato, que são dados
  pessoais. A equipe de engenharia não pode ver isso (AGENTS.md, regra 5).
- **Regras e memória, sem modelo de IA por enquanto.** Em ordem: o que a família já fez com aquele estabelecimento,
  palavras conhecidas (`packages/domain/src/categorize.ts`) e, sem pista, "Outras" marcada para revisar. Enviar extrato
  a um serviço de IA exige chave, decisão do fundador, custo definido e mudança na Política de Privacidade.
- **Propõe, não aplica** (regra 7). A proposta aparece na revisão. Nada é gravado até a família clicar em Importar,
  inclusive a criação de categorias.
- **Categoria nova** nasce quando a palavra é conhecida e a família não tem a categoria, ou quando a pessoa digita um
  nome. Nome igual, ignorando acento e caixa, reaproveita a existente e desarquiva, se preciso.
- **Memória em `category_memory`**, por `merchantKey`: tira números e palavras de meio de pagamento, para "COMPRA CARTAO
  LOJA X 22" e "Pix enviado Loja X" serem o mesmo lugar. Só guarda o que a família confirmou. O histórico de
  lançamentos vem antes, então editar um lançamento depois corrige o agente.
- **Relatório em `household_reports`**, um por importação, sob RLS, para o assistente da família consultar na Fase 3.
  Desfazer a importação mantém o relatório e anota o fato.
- **Para a equipe de agentes, só contagens** em `ops.categorization_stats`, no `/api/ops/context`. O Tech Lead acompanha
  no resumo semanal. Falhar nessa gravação não afeta a importação.
- **PDF e Excel lidos no navegador.** `.xlsx` por `read-excel-file`, sem Web Worker próprio por causa da CSP. PDF por
  `pdfjs-dist`: linha com data no início e valor no fim, com dois valores no fim o último é o saldo. `.xls` antigo não é
  lido, porque a biblioteca que o lê tem falha conhecida. Ambos entram com origem `csv`, para não mexer na restrição
  de `import_batches`.

## Limites conhecidos

PDF sem sinal no valor decide entrada ou saída pela descrição, e a tela pede conferência. PDF escaneado não tem texto
e é recusado com aviso. Pix para pessoa física costuma ficar em "revisar" na primeira vez. Cada banco monta o PDF de um
jeito, e o leitor só foi testado com um arquivo montado aqui, não com extratos reais.
