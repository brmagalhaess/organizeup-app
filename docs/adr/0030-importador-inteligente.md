# ADR-0030 — Importador inteligente

Status: aceito (2026-11-02). Especificação em `docs/specs/importador-inteligente.md`.

Soma ao ADR-0018 (o modelo lê arquivo de qualquer tipo) e ao ADR-0019 (arquivo no banco). Abre uma exceção ao ADR-0006
e ao ADR-0024: nesta tela o arquivo vai ao servidor. O importador de extrato e o da carteira continuam lendo no navegador.

## Decisão

### Agente por pedido

`importador` não é agente diário: roda quando a família envia arquivos, na fila `smart-import`, um arquivo por vez. Fica
fora de `DAILY_AGENTS_ENABLED`, porque a família está esperando, e fora de `AGENT_MODULE`, porque nenhum módulo o liga
sozinho. Tem cartão no painel, com interruptor e sem botão de rodar. Desligado, as regras continuam e o modelo não é
chamado. `ops.agent_runs` guarda só contagens, e `suggestions` e `applied` ali são lidos com IA e por regras. Como no
resto da tabela, repetir no dia substitui as contagens, então o cartão mostra o último lote e quantos houve.

### Três tabelas, migração 0042

`smart_imports` (lote), `smart_import_files` (conteúdo em `bytea`, como `debt_documents`, e o que foi entendido) e
`smart_import_items` (uma proposta por item). `payload` e `fields` são rascunho. `result_id` não tem FK: apagar o lote não
apaga o que a família aprovou. `ou_admin` não lê nenhuma das três: arquivo e rascunho são da família, e a cascata de
apagar a família não depende de grant.

### Regras primeiro, modelo só no que sobrar

`SMART_RECOGNIZERS`, em ordem: OFX, NF-e e CF-e, B3, SINACOR, extrato em Excel, CSV ou texto, extrato em PDF. Leitura por
regras não depende do aceite de IA. **XML nunca passa por biblioteca de XML**: é lido por expressão regular, então não há
entidade a resolver, e DOCTYPE é recusado na porta. `parseDividendFile`, da frente `agente/importar-proventos`, entra como
mais um reconhecedor: destino, revisão e gravação de `provento` já existem, e o modelo já pode propor esse destino.

### Leitura isolada

Abrir arquivo é a parte perigosa. PDF e XLSX inflam, e expressão regular pode travar. Por isso, abrir e reconhecer rodam
num processo filho (`read-child.ts`), sem nenhum segredo no ambiente, com `--max-old-space-size` e tempo-limite de 30
segundos, controlado de fora pelo pai, que mata o filho. Lá dentro, a leitura fica numa thread com `resourceLimits`, e a
thread principal só vigia a memória total do processo, com teto de 640 MB, porque buffer de descompressão não conta como
heap do V8.

- **Zip:** cada entrada é inflada de verdade, com teto na saída (64 MB no total), antes de abrir. Tamanho declarado no
  diretório central não muda a conta.
- **PDF:** cada fluxo é inflado com teto (128 MB) antes do pdf.js. Filtro em cascata passa dessa conta, e quem para é o
  vigia de memória.
- **`read_attempts`:** depois de 2 tentativas o arquivo vira falho (`queda`), para quem derruba a leitura não entrar em
  laço. Ler de novo pela tela zera a contagem.
- **Um arquivo por job:** o worker lê um e reenfileira o lote no fim da fila. Nenhuma família espera 10 arquivos de outra.
- **Expressão regular:** NF-e e CF-e são lidas por varredura com `indexOf`, linear. Linha acima de 400 caracteres não entra
  na busca de valores do PDF. O que sobrar, o tempo-limite pega.

### Modelo

- **Uma chamada por arquivo, rota `importador`**, esforço `medium`, `claude-haiku-5-5`. Fora de `withHousehold`.
- **Sem `tools`**, saída por `output_config.format`. `requestParams` não serve aqui: ele sempre manda `tool_choice`, e a
  API recusa `tool_choice` sem ferramentas. É o mesmo desvio de `categorias` e `relatorios`.
- **`IMPORTER_PROMPT` é fixo**, sem data nem dado, com marca de cache: a data vai na mensagem.
- **Esquema sem nada anulável.** O que falta vem como texto vazio. Cada `null` é uma união, e esquema com muitas uniões
  corre o risco de ser recusado. O servidor faz a conferência toda de qualquer forma.
- **`strict` no zod:** campo fora do esquema descarta a resposta inteira, e o arquivo fica para reprocessar.
- **Todo valor é revalidado** em `buildSmartPayload`, com `packages/domain`. Número só `123` ou `123.45`: vírgula,
  milhar, sinal e expoente são inválidos, e `1e400` não vira nada. Data só `AAAA-MM-DD`, de verdade. A tela converte o que a
  pessoa digita no idioma dela e manda sempre nesse formato, então `0.125` não vira `125`. Valor em `numeric(14,2)`, código
  de ativo pelo formato. O que não confere vira vazio, e a revisão mostra o que falta. Texto com link, ordem ou marca não
  entra (`safeText`). Trecho perde `<` e `>` e aparece como texto puro.
- **Totais:** soma dos itens contra o total do documento, e parcela vezes quantidade contra o saldo. Não fechou, a
  confiança cai para baixa e a tela avisa. Não bloqueia: quem decide é a pessoa.

### Dados pessoais

- **O que vai:** o texto do arquivo, depois de `privacy.scrub`, que troca CPF e CNPJ por `maskDocuments`, e-mail e nomes
  da família. PDF com texto é extraído no servidor para isso ser possível, ao contrário do ADR-0019, que manda o PDF
  inteiro. Nome do arquivo não vai.
- **A exceção da máscara é a digitalização.** PDF sem texto e foto não têm o que trocar: vão como estão, até 20 páginas e
  5 MB, ou 3,75 MB em imagem. A extração precisa da imagem, a tela e a Política dizem isso, e é por isso que há teto.
- **O filtro não acha nome de terceiro** no texto do arquivo, como já não achava no extrato. Por isso o que volta tem
  barreira própria: `campos` com rótulo de CPF, nome, endereço, fiador, avalista ou dependente são descartados, e dado de
  terceiro não vira cadastro em `people`.
- **Sequência enorme sem espaço sai antes do filtro.** A busca de e-mail fica quadrática nela, e um arquivo travaria o
  worker. Também por isso o que volta do modelo é cortado em 1.000 caracteres antes de filtrar.

### Aceite

Por escopo, em `household_file_scopes`, escopo `importador`, com `IMPORTER_CONSENT_VERSION = 2026-11-02.1`: é tratamento
mais amplo que o de dívidas, e um aceite não abre o outro. O de dívidas segue em `household_file_consents`, cuja chave é só
a família. Desligar o assistente retira os dois. Sem o assistente ativo, sem esse aceite ou sem `use_ai`, o arquivo que as regras não entendem fica marcado com o motivo e pode
ser reprocessado depois. `LEGAL_VERSION` subiu para a mesma versão.

**Pendente de advogado:** a seção da Política sobre qualquer arquivo, dados de terceiros em contratos e os 30 dias de
retenção foi escrita sem revisão jurídica. O fundador precisa passar com o advogado antes de ligar para o público.

### Custo

Fica no módulo Assistente, sem gastar mensagem. `SMART_MODEL_FILES_PER_MONTH` = 30 e `SMART_MODEL_TOKENS_PER_MONTH` =
1,5 milhão por família, somados de `ai_usage`, que a família não apaga. Os tetos do ADR-0018 continuam valendo: o portão
é conferido antes de cada arquivo. O mesmo arquivo em outro lote reaproveita a leitura. 120 mil caracteres por arquivo,
com aviso de corte. Cálculo em `docs/custos.md`.

### Consórcio

Vira dívida `manual`, nome "Consórcio …", taxa zero. É o que ele é para o dinheiro da família: parcela fixa sem juro a
abater, e na ordem de ataque fica por último, que é o certo, porque antecipar parcela de consórcio não economiza juro.
Não ganhou coluna: `debts` é lida com `select()` em muitos lugares, e coluna nova exigiria a web esperar o worker em
todos eles. Taxa de administração e crédito ficam nos campos do documento.

### Duplicidade

Compara com a conta do arquivo, quando ela existe: o mesmo valor em outra conta não é duplicado. Entre arquivos do lote a
comparação continua, porque extrato e fatura têm instrumentos diferentes. `reconcileRows` agrupa por sentido e valor, para
10 arquivos de 5.000 itens não ficarem quadráticos, e a revisão grava o veredito em uma instrução por pedaço.

**Pagamento de fatura:** a linha do extrato que fecha com a soma das compras de outro arquivo do lote vira "possível
duplicado". Marcada, ela não vira despesa: depois de gravar as compras, dá baixa na fatura (`f:`), que é movimento de
cartão. Sem isso, a despesa do mês contaria 600 em vez de 300. Só fecha se a fatura gravada der o mesmo valor.

Reaproveita o que existe: `withFingerprints` e `reconcileRows` para extrato, com a mesma impressão digital do importador
clássico, então arquivo importado lá é reconhecido aqui. `planInvestmentImport` para operação, com as do arquivo anterior
do lote como carteira de faz de conta. `matchKnownDebt` para dívida. Previsão de mesmo valor dá baixa, como no extrato.

"Já lançado" e "possível duplicado" nascem desmarcados. A pessoa pode marcar à força: a impressão digital e a comparação
de operações seguram na gravação. Compra de cartão não tem impressão digital no banco: marcada à força, duplica. É a
pessoa decidindo, e a tela avisou.

### Aprovação

Regra 7: é dado informado, por aceite na tela. A rotina fica em `apps/web/src/lib/importador/commit.ts`, porque usa
`confirmCommitment` e `recordTradeCash`.

- **Em pedaços de 200 itens**, cada pedaço numa transação curta, sob a trava da família, com `FOR UPDATE` e a marca de
  gravado junto. Cada item fica num savepoint: erro desfaz só ele, inteiro. Dois cliques e dois lotes passam em fila.
- **`planSmartDuplicates` roda de novo em cada pedaço**, contra o que está gravado agora, sem contar o que este mesmo lote
  gravou. Item que piorou desde a revisão fica como `duplicado_agora` e não grava. Arquivo igual em outro lote aberto é
  recusado no envio.
- **Operações de um arquivo gravam juntas**, sob a trava da carteira, porque a comparação olha a nota inteira.
- **Erro desfaz o item inteiro** e fica no próprio item, com código. Tentar de novo só refaz o que falhou.
- **Limite de lançamentos é conferido antes**: passou, nada grava e a tela diz quantos cabem. Cada item ainda reconfere,
  por causa de corrida.
- **`canUse` por destino**, em `SMART_DESTINATION_MODULE`. Item de módulo desligado aparece e não grava, e a família pode
  ligar o módulo depois e aprovar.
- **`import_batches`:** lançamentos ganham uma linha por arquivo e conta, então o Desfazer do histórico de Importar
  funciona. Item desfeito lá continua como gravado aqui.
- **Operação não mexe em conta**, porque a conta de origem nasce vazia, como no ADR-0024.
- **Atualizar dívida existente** continua em Dívidas > Importar: aqui a dívida parecida vira "possível duplicado".

### Lote grande

- **Comparação linear.** Os lançamentos conhecidos ficam indexados por tipo, valor e dia (`takeClosest` em
  `statement.ts`). Lote com todas as linhas do mesmo valor deixou de ser quadrático: era o que travava 10 CSVs de 5.000
  linhas por 406 s.
- **Comparação fora da thread principal.** O job carrega o que precisa, compara no processo isolado (`planInChild`) sem
  transação aberta e grava o veredito depois, sob a trava da família. Se o filho não responder, compara no processo.
- **Teto de itens em aberto por família**, `SMART_MAX_OPEN_ITEMS`, medido no banco, no envio e na leitura.
  Passou, o envio é recusado (`teto_itens`) com a saída: aprovar ou apagar um lote. Sem isso, um usuário empilharia lotes
  até pesar o banco de todos.
- **Justiça por família.** Cada job lê um arquivo e volta ao fim da fila, e a família tem um lote em leitura por vez: o
  segundo espera `SMART_WAIT_SECONDS`, com hora marcada, em vez de reenfileirar na hora. Leitura presa também espera: não
  há job que volte sem ler nem contar tentativa.
- **Paginação.** A revisão mostra `SMART_REVIEW_PAGE_SIZE` itens. Os totais vêm de agregação no banco.

### Aprovar o que foi visto (decisão do produto)

- Item tem `seen`. A tela marca o que apareceu; `approveSmartImport` só grava `selected` e `seen`. Item marcado em outra
  página continua proposto, e a tela diz quantos.
- **Marcar todos** é o único caminho para aprovar o que não apareceu: pede confirmação com quantos itens, a soma de entrada
  e saída e quantos ainda não apareceram. O servidor recalcula sob a trava e só aplica se a contagem for a da tela.
- Item de baixa confiança nunca nasce marcado.
- `toggleAll` virou `clearAll` e `confirmAll`, ambos sob `lockFamilyImport`, a mesma trava da aprovação, para as duas não se
  esperarem em ordens diferentes. `failItems` não toca em item `gravado`.

### Conta, extrato e fatura

- **A impressão digital vale por conta.** Sem conta definida no arquivo, igualdade vira `possivel` com motivo `outra_conta`,
  nunca `ja_lancado`. `setFileTarget` pede nova comparação, e o veredito se refaz com a conta escolhida.
- **Extrato em um lote, fatura em outro:** ao ler a fatura, `findRecordedPayments` procura lançamento já gravado com texto de
  fatura e valor que feche as compras, e propõe a baixa como `possivel` (`pagamento_gravado`). Aceitar transforma aquele
  lançamento no pagamento da fatura, em vez de criar outro.
- `pagamento_fatura` só com texto de fatura e valor que feche. `mergeSmartEdit` limpa `settlesFileId`: editar a linha desfaz
  a suposição.
- A baixa guarda em `result_id` o lançamento que ela criou ou encontrou.

### Proventos

CSV e XLSX Recebidos passam por `parseDividendFile` antes do reconhecedor de extrato: arquivo de proventos nunca vira
lançamento, nem se passar do limite de linhas (entra pela metade, com aviso `itens_cortados`). A comparação é a de
`planDividendImport`, e a gravação é a de `lib/dividend-write.ts`, a mesma de `/app/proventos/importar`, com
`importedDividendId`, que é o que faz o Mercado e o Desfazer respeitarem a linha (ADR-0029).

### Liberação em etapas (decisão do produto)

`ops.feature_flags` ganha `smart_import_enabled`, desligada. O motivo: nunca rodou em Linux nem com IA real.

- Desligada, só o admin do serviço (`isServiceAdmin`) vê o importador, com tudo funcionando. Família comum não vê botão nem
  rota: tela, action e `/api/importador` respondem 404, no servidor (`requireSmartImport`).
- Lote do admin nasce com `preview`, e o worker recusa lote sem `preview` enquanto a chave estiver desligada.
- O admin liga em `/admin/cobranca`, com auditoria (`importador:ligar`, `importador:desligar`).
- `canUse` continua valendo item a item.

### Retenção

Lote sem nada aprovado some depois de 30 dias, no job das 04:50. Lote com aprovação fica, como anexo de dívida, até a
família apagar. Até 100 MB por família, separado dos 50 MB de dívidas. Para contrato, o arquivo também entra nos anexos da
dívida, se couber.

### Para os agentes

`ver_documentos` entrega tipo, emissor e campos do que a família aprovou como documento. O arquivo nunca vai ao assistente.

## O que o processo isolado garante, e o que não

No bundle do worker o filho roda com `--permission`, lendo só o próprio arquivo, sem escrita, sem `child_process`, sem
addons, e com ambiente mínimo: nada de `DATABASE_URL` nem de chave do modelo. `--allow-worker` é necessário para a thread
com limite de memória. O teste `apps/worker/src/smart-child.integration.test.ts` monta o bundle e prova isso em Windows.

Não dá para garantir:

- **Rede.** O Node 24 não tem flag para bloquear rede. Lá dentro não há código que a use nem credencial a roubar, mas um
  escape no pdf.js alcançaria a rede do contêiner. Fechar de verdade pede rede interna no Dokploy ou `--network=none`.
- **Linux.** Nada disso rodou em Linux: nem o modelo de permissão, nem os limites de memória, nem `SIGKILL`. Antes de ligar a
  chave, rodar `smart-child.integration.test.ts` e as bombas no contêiner de produção.
- **Modelo de permissão não é sandbox.** A documentação do Node avisa que ele não protege contra código malicioso que
  consiga escapar do JavaScript. Ele reduz o estrago de um bug, e `seccomp` no contêiner seria a camada seguinte.
- **Na fonte não há permissão.** Em dev e nos testes o filho roda pelo `tsx`, que grava cache e abre o esbuild. Produção usa
  sempre o bundle.

## Riscos aceitos

- **Extrato passa pelo servidor nesta tela**, ao contrário do ADR-0006. É o que permite ler em lote com a pessoa fora da
  tela. A Política diz isso.
- **Banco e backup crescem**: no limite, 100 MB por família, além dos 50 MB de dívidas. A saída é mover o conteúdo.
- **Digitalização sai sem máscara.** A tela avisa.
- **Nome de terceiro vai ao modelo** dentro do texto de um contrato.
- **Regra de texto é palpite**: "Ignore" num nome de loja vira vazio, e a pessoa preenche.
- **Fatura em CSV é reconhecida por palpite**: coluna de estabelecimento e quatro em cinco valores positivos.
- **Parcelada em fatura entra como compra à vista daquele mês**, porque cada linha é a parcela do mês. Importar como
  parcelada contaria de novo a cada fatura.
- **A leitura pode errar um número.** Nada entra sem aprovação.

## A conferir com a IA real

Ver a lista em `docs/specs/importador-inteligente.md`, seção 8.
