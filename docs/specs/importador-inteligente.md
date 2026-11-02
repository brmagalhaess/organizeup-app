# Especificação — importador inteligente

Pedido do fundador em 2026-11-02: um botão no painel para importar arquivos, em que um agente entende de onde cada
arquivo veio e onde cada linha se encaixa, lança em qualquer parte do sistema, elimina duplicidade e aceita PDF, XML e
até 10 arquivos por vez, como contrato de empréstimo ou de consórcio. O agente organiza e mostra tudo; com aprovação, o
cadastro é feito. Decisões duráveis ficam no ADR-0030.

Agente novo: `importador`. Não é agente diário: roda por pedido da família, no worker, fora da rodada da madrugada.

## 1. Telas

### Entrada

- **Painel:** botão "Importar arquivos" no cabeçalho, para quem pode escrever.
- **`/app/importar`:** cartão "Importar arquivos" acima do importador de extrato, que continua igual.

### `/app/importar/arquivos` — enviar e acompanhar

**Campos:** escolher arquivos, até 10 por vez. Aceita PDF, XML, XLSX, CSV, OFX, TXT, PNG e JPG. Cada arquivo tem até 10
MB, o lote até 40 MB e a família até 100 MB. Interruptor "Usar IA no que as regras não entenderem", ligado por padrão
quando o portão de IA está pronto.

**O que a tela explica:** o que vai ao serviço de IA (só o texto do arquivo que as regras não entenderam, com CPF, CNPJ,
e-mail e nomes da família trocados; digitalização vai como está), que é fora do Brasil, o limite de arquivos do mês e o
que já foi usado. Sem nome de fornecedor na tela. A Política cita.

**Estados:**

- Vazio (primeiro uso): nenhum lote, com a explicação em três passos: enviar, conferir, aprovar.
- Enviando: uma linha por arquivo, com sucesso ou o motivo da recusa. Arquivo recusado não impede os outros.
- Sem aceite: a tela oferece o aceite de arquivos; a leitura por regras funciona sem ele.
- Sem assistente, sem plano, teto, limite de arquivos, IA desligada: aviso do motivo, e as regras continuam.
- Carregando, erro ao carregar e "em atualização" enquanto a migração não chegou.
- Quem só vê (`child`, `viewer`) lê a lista, sem enviar.

**Lista de lotes:** data, quantidade de arquivos, situação e o link da revisão, com apagar lote.

### `/app/importar/arquivos/[id]` — progresso, revisão e relatório

**Progresso:** barra com arquivos prontos do total, situação de cada arquivo. A tela atualiza sozinha e a pessoa pode
sair: ao terminar chega uma notificação com o link.

**Revisão:** totais no topo (itens, novos, já lançados, possíveis duplicados, o que não dá para gravar, valor que entra
e valor que sai). Depois, um bloco por arquivo com:

- o que é o arquivo, de onde vem, confiança, como foi lido (regras ou IA), se foi cortado;
- conta e cartão do arquivo, que valem para os itens sem escolha própria;
- o que não foi entendido;
- itens agrupados por destino, com caixa de seleção, descrição, data, valor, categoria, confiança, situação de
  duplicidade e o trecho de onde veio;
- editar item: os campos do destino, com a mesma validação do servidor;
- reprocessar arquivo que falhou; baixar o arquivo.

**Regras da revisão:**

- Nasce marcado só o que é novo e pode ser gravado. "Já lançado" e "possível duplicado" nascem desmarcados.
- Item de módulo desligado aparece, sem caixa, com a explicação e o link do plano.
- Item sem o que falta para gravar (conta, categoria, data) mostra o que falta e bloqueia só ele.
- O botão diz quantos itens vão entrar: "Aprovar 4 itens". Só `owner` e `adult`.

**Relatório:** depois de aprovar, a mesma tela diz quantos entraram, quantos já existiam e quantos falharam, com o motivo
de cada falha. Tentar de novo só refaz o que falhou.

**Estados da revisão:** nada para aprovar (só documentos), tudo aprovado, lote apagado, e sem permissão.

## 2. Fluxo

1. A tela cria o lote e envia um arquivo por vez à rota, que confere tipo pelo conteúdo, tamanho e cotas.
2. "Começar" põe o lote na fila `smart-import`. Se o aviso se perder, a própria tela pede de novo depois de 2 minutos
   parada.
3. O worker lê um arquivo por vez, em processo isolado, com teto de memória e de tempo, e o lote volta para o fim da
   fila a cada arquivo. Falha em um arquivo não para os outros.
4. **Identificação:** parsers sem IA primeiro: OFX, NF-e, CF-e, B3, SINACOR, extrato em CSV, Excel ou PDF. Depois de
   mesclada a frente de proventos, `parseDividendFile` entra na lista de reconhecedores.
5. **IA:** só no que as regras não entenderam, com o portão aberto. Uma chamada por arquivo, sem ferramentas, saída por
   `json_schema`, tudo revalidado no servidor.
6. **Encaixe:** cada item vira proposta com destino, conta, cartão e categoria sugeridos.
7. **Duplicidade:** compara com o que existe e entre os arquivos do lote.
8. **Notificação:** ao fim, com o link da revisão.
9. **Aprovação:** em pedaços curtos, sob a trava da família, comparando de novo com o que está gravado. Cada item fica
   inteiro ou de fora. Operações de um arquivo gravam juntas, porque a nota precisa fechar. Item já gravado é pulado.
   Repetir não duplica. Pagamento de fatura vira baixa depois de gravar as compras, e nunca despesa nova.

## 3. Destinos

| Destino          | Grava em                                | Módulo        |
| ---------------- | --------------------------------------- | ------------- |
| Lançamento       | `transactions`, com baixa de previsão   | Base          |
| Compra de cartão | `card_purchases`                        | Base          |
| Operação         | `investment_trades`, com conta opcional | Investimentos |
| Provento         | `dividends`                             | Investimentos |
| Dívida           | `debts` com parcelas                    | Dívidas       |
| Consórcio        | `debts`, nome "Consórcio …", taxa zero  | Dívidas       |
| Renda            | `income_sources`                        | Base          |
| Previsão         | `cashflow_plans`                        | Base          |
| Meta             | `goals`, sem plano calculado            | Metas         |
| Documento        | o próprio arquivo, com campos extraídos | Base          |

Consórcio não ganhou tipo novo nem coluna: é compromisso de parcela fixa sem juro a abater, e a dívida `manual` com taxa
zero descreve isso. O motivo está no ADR-0030.

## 4. Duplicidade

| Situação           | Quando                                                                         | Marcado |
| ------------------ | ------------------------------------------------------------------------------ | ------- |
| Novo               | Nada parecido                                                                  | Sim     |
| Já lançado         | Mesma impressão digital, operação igual, provento igual, documento igual       | Não     |
| Possível duplicado | Mesmo valor e sentido a até 3 dias, ou em outro arquivo do lote, nome parecido | Não     |

## 5. Limites

Arquivo, lote e família na seção 1. Até 5.000 itens por arquivo, com aviso. Leitura isolada: 30 segundos, 640 MB, 64 MB
inflados em planilha e 128 MB em PDF; duas quedas e o arquivo fica como falho. Na tela, os primeiros 200 de cada grupo;
Marcar e Desmarcar todos valem para o lote inteiro. Enviados à IA: 120 mil caracteres por arquivo, com aviso de corte na tela; digitalização
até 20 páginas e 5 MB; imagem até 3,75 MB. Por mês: 30 arquivos lidos com IA por família, e 1,5 milhão de tokens. Teto
diário e teto do serviço do ADR-0018. Não gasta mensagem do assistente.

## 6. Retenção

- Lote que nunca teve nada aprovado é apagado depois de 30 dias.
- Lote com algo aprovado fica guardado, como os anexos de dívida, até a família apagar.
- Apagar o lote leva arquivos, propostas e campos extraídos, e não mexe no que já foi gravado.
- Apagar a família apaga tudo. Exportar traz metadados e propostas, sem o conteúdo dos arquivos.

## 7. Para os agentes

O que a família aprovou como documento fica em `ver_documentos`: tipo, emissor e campos extraídos, com máscara. O arquivo
inteiro nunca vai ao assistente.

## 8. O que só se prova com a IA real

Tudo aqui foi testado com modelo falso. Antes de abrir ao público, conferir com arquivos verdadeiros, sem usar dados de
cliente:

- A API aceita o esquema como está, sem recusar por tamanho ou complexidade, e o Haiku 5.5 respeita `output_config.format`
  em arquivo longo.
- Contrato de empréstimo, de consórcio e de financiamento verdadeiros: saldo, taxa, parcelas e a escolha entre `divida` e
  `consorcio`.
- Holerite, informe de rendimentos, apólice e boleto: tipo certo e destino certo.
- PDF digitalizado e foto: leitura, custo por página e se 20 páginas bastam.
- Se a instrução escondida num arquivo real muda algo que a validação não pega, como um valor plausível e errado.
- Custo real por arquivo em `ai_usage`, contra a estimativa de `docs/custos.md`.
- `max_tokens` de 24 mil basta num extrato em PDF que as regras não entenderam.
- Layout real de NF-e, CF-e, Negociação, Movimentação e nota de corretagem: os parsers foram escritos por especificação.
