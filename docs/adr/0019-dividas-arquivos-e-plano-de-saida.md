# ADR-0019 — Arquivos de dívida e plano de saída

Status: aceito (2026-11-01).

Soma ao ADR-0005 (dívidas), ao ADR-0015 (agentes diários, que passam a ser seis) e ao ADR-0018 (o modelo
agora lê arquivos). Não muda o ADR-0006: o extrato continua sem sair do navegador.

## Decisão

### Arquivos

- **Ficam no banco** (`debt_documents.content`, `bytea`), sem serviço novo de arquivos: é um dado de família
  como qualquer outro, com a mesma RLS e o mesmo backup. Até **10 MB por arquivo** e **50 MB por família**.
  Quem sentir o peso primeiro é o backup: se ele crescer demais, a saída é mover o conteúdo, não apagar.
- **Listagem nunca traz o conteúdo.** `select()` sem colunas traz, por isso há `debtDocumentMeta`. Só baixar e
  ler selecionam `content`. A exportação da família lista os metadados e diz que o arquivo ficou de fora.
- **O tipo vale pelo conteúdo** (`checkDebtFile`), e a extensão precisa concordar: assinatura de PDF, PNG e JPG;
  diretório central do zip com `xl/workbook.xml` no XLSX, somando o tamanho descomprimido para barrar arquivo-bomba
  (100 MB); texto sem caractere de controle, com separador e sem começar por `<` no CSV.
- **Mesmo conteúdo não duplica**: `UNIQUE (household_id, sha256)`. A cota e a duplicata ficam sob uma trava de
  transação por família, para dois envios juntos não passarem.
- **Baixar é sempre anexo**, com `nosniff`, `no-store` e tipo fixo: o navegador nunca abre o que foi enviado.
- **Envio por rota, não por server action**, porque o limite das actions é de 3 MB (ADR-0006).
- **Apagar a dívida ou a família apaga os arquivos** (FK em cascata). Encerrar dívida com histórico mantém.

### Leitura com IA

- **Duas portas**: `assistantState` em `pronto` (assistente ativo, teto, papel) e o aceite de arquivos, em
  `household_file_consents`, com versão mínima `FILES_CONSENT_VERSION`. É tratamento novo: o arquivo vai inteiro,
  com nome e CPF, o que o ADR-0018 evitava na conversa. A tela avisa sem citar fornecedor; a Política cita.
  Desligar o assistente apaga o aceite. Sem as duas portas, o arquivo fica guardado e a pessoa preenche à mão.
- **Tabela própria para o aceite**, e não coluna em `household_settings`: há leituras de todas as colunas daquela
  tabela, e a web pode subir antes de o worker migrar.
- **Uma chamada por arquivo**, rota `dividas` em `ai_usage`, fora de `withHousehold`: marca `lendo`, fecha a
  transação, chama, grava o uso, grava o rascunho. A marca impede dois cliques de pagarem duas leituras e vence em
  5 minutos.
- **Sem ferramentas e com `json_schema`**, então um texto no arquivo não tem o que acionar. O arquivo vai como bloco
  de documento, nunca nas instruções. O nome do arquivo não vai. CSV e XLSX passam pelo filtro de nomes; PDF e imagem
  não têm como, e a Política diz isso. Toda resposta é revalidada campo a campo: o que não confere, ou credor com
  jeito de ordem ou link, vira campo vazio e duvidoso.
- **`extracted` é rascunho.** Nada em `currentDebtPlan`, nas ferramentas ou nos agentes lê essa coluna. A dívida só
  nasce ou muda em `confirmDebtDocument`, com o que a pessoa deixou na tela, pela mesma rotina do cadastro manual.
- **Um arquivo, uma dívida.** Com mais de uma, a leitura traz a maior e a tela avisa. É o que garante que confirmar
  duas vezes não cria duas dívidas.
- **Arquivo de dívida que já existe**: a conferência já vem em "Atualizar" (`matchKnownDebt`: palavra em comum com o
  credor, ou mesma parcela e número de parcelas). Atualizar troca as parcelas em aberto; as pagas ficam.
- **CET é só informativo**: fica em `extracted`, não entra em cálculo nem em coluna da dívida.

### Plano de saída

- **`planDebtPayoff`** em `packages/domain` compara maior juro primeiro e menor saldo primeiro com `allocation.debt`,
  contra só pagar as parcelas. A tela, `ver_plano_dividas` e o agente usam `currentDebtPlan`, então dão o mesmo
  número. Recalcula a cada leitura: dívida nova aparece na hora, sem esperar a madrugada.
- **`simulatePayoff` deixou de arredondar os juros a cada mês.** Com centavos acumulados, a bola de neve chegava a
  sair R$ 0,14 mais barata em 13 de 30 mil casos, só por arredondamento. Sem isso, a propriedade "avalanche nunca
  paga mais juro" vale, conferida em 100 mil casos. O total sai em centavos no fim.
- **Agente `dividas`**, antes da aposentadoria. O extra vem de `currentDividendPlan`, que não depende de ela ter
  rodado. Grava `debt_plan_reports` e as sugestões `aporte_divida` da estratégia mais barata. A aposentadoria só gera
  essas sugestões no dia em que o agente de dívidas não rodou, e as duas leem as decisões sem filtro de agente: a
  chave é a mesma, e sugestão ignorada não pode voltar por outro caminho. Sugestão aceita não volta no mesmo mês.
- **`debt_plan_reports` em vez de `household_reports`.** Um tipo novo lá exigiria trocar a CHECK de `kind`, e isso
  não é aditivo (regra 3). `relatorios_do_dia` junta as duas tabelas.
- **Sinais**: juro acima do que o dinheiro rende (`isExpensiveDebt`); parcela antes da primeira renda do mês;
  portabilidade ou renegociação a partir de **2,5% ao mês**, sem citar instituição; dado faltando quando não há juros
  informados. Os sinais ficam no plano, sem sugestão própria.

### Tela

- **Dívidas**: cabeçalho, dicas, plano ("Quite tudo em…", neste mês, ordem de ataque, pontos de atenção, as duas
  estratégias), totais, cartões e o simulador de sempre. Sem dívida, só o estado vazio. Se o plano falhar, um aviso, e
  o resto da tela segue. Cada cartão abre os arquivos: ver, baixar, anexar e apagar; só `canWrite` anexa e apaga.
- **Dívidas > Importar** (`/app/dividas/importar`): aviso e aceite, envio de um ou vários arquivos, e uma conferência
  por arquivo, com os campos duvidosos destacados. Sem leitura, a mesma conferência vem vazia.

## Fora do escopo por enquanto

Pagamento extra como lançamento (a sugestão aceita só registra a decisão, como antes). Indexadores e juros de dívida
atrasada. Mais de uma dívida por arquivo. Ler arquivo em lote pela API de Batches. OCR próprio.

## Riscos aceitos

- **Documento inteiro sai do Brasil**, com nome, CPF e endereço de quem assinou, inclusive de terceiros, como um
  fiador. É o que a família autoriza no aceite. O fundador confere o texto com o contrato vigente antes de ligar.
- **PDF longo custa mais do que parece.** O teto é conferido antes da chamada e não se sabe o tamanho em tokens antes
  de enviar: um arquivo pode passar do teto diário uma vez. O pior caso é da ordem de US$ 0,50 por arquivo.
- **Banco e backup crescem.** No limite, 50 MB por família.
- **A leitura pode errar um número.** Por isso nada entra sem conferência, e o campo sem certeza vem destacado. Campo
  com confiança alta e valor errado depende de a pessoa olhar.
- **SAC simulado com parcela constante.** O prazo do plano sai um pouco mais curto que o calendário real.
