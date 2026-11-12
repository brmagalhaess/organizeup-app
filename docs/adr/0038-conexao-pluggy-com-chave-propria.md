# ADR-0038: Conexão com bancos pela Pluggy, com a chave de cada pessoa

- Status: aceito, em liberação por etapas (chave `bank_feed_enabled`, desligada)
- Data: 2026-11-11
- Pedido do fundador em 2026-11-11

## Contexto

`docs/specs/conexao-de-contas.md` deixou o Open Finance para quando houver 126 conexões pagas, porque o plano de
produto da Pluggy parte de R$ 2.500 por mês. A Pluggy tem também o **Meu Pluggy**, um plano pessoal gratuito: a
pessoa conecta até 5 contas em seu próprio nome, cria uma aplicação no painel e lê os próprios dados pela API com
o Client ID e o Client Secret dela. É o caminho que o Actual Budget usa.

O fundador pediu para o OrganizeUp aceitar a chave de cada pessoa: ela se cadastra na Pluggy, gera a chave e
informa aqui, e o sistema passa a trazer receitas, despesas e investimentos.

## Decisão

1. **Cada chave é de uma pessoa do cadastro.** Uma chave por pessoa e por família (`bank_connections`, com
   `person_id`). Quem está logado guarda até duas: a sua e a de outra pessoa adulta do cadastro, pedido do
   fundador em 2026-11-11 para o casal usar um login só. A chave da outra pessoa é criada por ela, na conta
   dela na Pluggy, e quem guarda marca que ela autorizou; a gravação fica na auditoria. Menor de idade não
   conecta. Só o login que guardou a chave vê, busca e remove; outro login da mesma família não enxerga nem as
   contas ligadas, e não consegue guardar outra chave para a mesma pessoa.
2. **Chaves cifradas.** Client ID e Client Secret ficam em AES-256-GCM (`lib/connection-vault.ts`), com a família,
   a pessoa e o campo como dado autenticado, e com chave derivada de `DOCUMENT_ENCRYPTION_KEY` por um rótulo só
   deste cofre. Nenhuma senha de banco passa pelo OrganizeUp. As chaves só são abertas no servidor, a pedido da
   própria pessoa. Elas não entram na exportação de dados. A conexão também entra no dado autenticado: quem
   guarda duas chaves não abre uma no lugar da outra.
3. **Nada entra sozinho.** A Pluggy alimenta as telas de importar que já existem. Lançamentos de uma conta ligada
   entram na conferência de `/app/importar` como se fossem um OFX, com o identificador da Pluggy na impressão
   digital (`ofx:id:pluggy:<id>`), então a mesma linha não entra duas vezes. A posição em ações, FIIs, ETFs e BDRs
   entra na conferência de `/app/investimentos/importar` como a planilha de Posição da B3, com o preço médio já
   preenchido quando a instituição informa quanto foi aplicado. Cota do plano, categorização, conciliação com o
   previsto e Desfazer continuam os mesmos.
4. **Uma conta daqui recebe uma conta do banco só** (índice único em `bank_connection_accounts`). Duas contas
   do banco na mesma conta do OrganizeUp embaralhariam a conferência, venham da mesma chave ou de chaves
   diferentes. Cada conta ligada mostra de quem é a chave. Conta conjunta aparece nas duas chaves: a tela avisa
   para ligar só uma. A posição em bolsa das duas chaves é somada por código, porque a carteira é da família.
5. **Busca a pedido da pessoa, na web.** Não há job diário nesta etapa. A Pluggy é chamada fora de
   `withHousehold` (regra 9). Lançamento pendente no banco não entra; a busca seguinte refaz os últimos 7 dias.
6. **Só o código do erro é guardado** (`error_code`), nunca o texto da Pluggy ou do banco.
7. **Liberação por etapas.** `bank_feed_enabled` nasce desligada: só o admin do serviço vê a tela. Quem liga é o
   painel (`/admin/cobranca`), com auditoria.

## Onde a pessoa acha

"Conexão com bancos" fica no menu lateral, logo abaixo de Contas, para quem pode usar. Há atalhos em Contas,
Importar extrato, Importar investimentos e Cartões (este só avisa que o cartão ainda não entra). O passo a passo
da tela usa os nomes do painel da Pluggy conferidos em 2026-11-11: Aplicações, Novo, Credenciais, "Gerar novo
secret" (o Client Secret aparece uma vez só), ícone Demo, "Conectar Conta" e "Itens Conectados".
O conector MeuPluggy vem desligado: o guia manda ligar em Dados Financeiros, Customização, Conectores,
"Conectores Diretos". Sem isso a lista de instituições só mostra Sandbox, como aconteceu no primeiro teste.

## Riscos aceitos e o que falta antes de ligar para todos

- **Termos da Pluggy.** A página do Meu Pluggy diz que o plano gratuito é para uso pessoal e que usar os dados em
  um produto para terceiros, ou uso comercial, exige plano pago. Aqui cada pessoa lê os próprios dados com a
  própria chave, mas dentro de um produto pago. Isso precisa de confirmação por escrito da Pluggy
  (sales@pluggy.ai) antes de a chave ser ligada para todas as famílias. Enquanto só o fundador usa, com a conta
  dele, é uso pessoal. A mesma página diz que conectar conta de cônjuge ou familiar não cabe no plano gratuito:
  por isso a segunda chave é sempre de outra conta na Pluggy, criada pela própria pessoa, e nunca a conta
  dela dentro da chave de quem está logado.
- **Regra da spec alterada.** `conexao-de-contas.md` dizia que ninguém conecta a conta de um familiar no lugar
  dele. A decisão de 2026-11-11 abre a exceção acima, com a confirmação de autorização.
- **Política de Privacidade.** A spec exige atualizá-la antes da primeira conexão de um cliente.
- **Resolução Conjunta 21 (entidade parceira).** Continua para validar com advogado, como na spec.
- **Nunca rodou com chave real.** O cliente foi escrito a partir da documentação e do SDK público da Pluggy, e
  testado com respostas simuladas. O primeiro uso com chave real é a verificação que falta.

## Contas, cartões e investimentos a partir da conexão (2026-11-11, depois do primeiro teste real)

O primeiro teste com conta real (XP, pelo MeuPluggy) trouxe 2 contas, 1 cartão e 27 investimentos, e mostrou o
que faltava. Migração 0051.

- **Criar daqui.** Cada conta do banco pode virar uma conta do OrganizeUp num clique ("Criar conta nova"), ou
  todas de uma vez. O cartão do banco vira um cartão daqui: a pessoa confirma o dia de fechamento, o de
  vencimento e a conta que paga a fatura. A instituição só informou o vencimento, então o fechamento é sugerido
  uma semana antes. Quem já tem a conta ou o cartão cadastrado escolhe o existente: nada é criado sozinho.
- **Mesmo nome, contas diferentes.** A XP manda duas contas com o mesmo nome e o mesmo número. O código do banco
  (`transferNumber`) entra no nome para separar.
- **Compras do cartão** entram em `card_purchases` pela mesma conferência do extrato, com categoria proposta. A
  instituição manda uma linha por parcela. Aqui cada compra é uma linha: da parcela mais antiga do período sai
  a compra com as parcelas que faltam, e o OrganizeUp distribui o resto pelas faturas. As parcelas da mesma
  compra dividem a impressão digital (dia da compra, loja, valor e número de parcelas), então a parcela do mês
  seguinte não entra de novo. Pagamento de fatura, estorno e lançamento pendente ficam de fora. Compra que
  cairia em fatura já paga não entra.
- **A impressão digital fica numa vista à parte** (`cardPurchaseImports`, sobre `card_purchases`), como a de uso
  do plano: quem lê compras no painel não depende da coluna nova durante a publicação.
- **Investimentos.** O tipo do ativo (ação, FII, ETF ou BDR) vem da instituição, então a conferência não
  pergunta. A corretora não informa quanto foi pago: o preço entra preenchido com o de mercado, com aviso para
  trocar antes de gravar ou corrigir depois em Lançamentos.

## Preço pago dos investimentos (2026-11-11)

A posição da corretora não traz o preço pago. A busca passa a pedir as compras e vendas de cada ativo de bolsa
(`/investments/{id}/transactions`) e calcula o preço médio: a compra soma ao custo e a venda sai pelo preço
médio do momento (`feedCostOf`). O preço só é dado como certo quando o histórico explica a posição inteira. O
Open Finance entrega cerca de 12 meses, então com histórico pela metade o preço médio conhecido entra como
estimativa. Sem compra nenhuma, vale o preço médio que a carteira já tem no OrganizeUp e, na falta dele, o de
mercado. A tela avisa em quantos ativos o preço é estimado, e só conta as linhas que vão virar operação. Se a
instituição não libera o histórico, a busca desiste na primeira recusa e segue como antes.

## Atualização automática (2026-11-11)

Pedido do fundador: depois de ligadas as contas e os cartões, o que cair no banco entra sozinho. Migração 0052.

- **Roda na web, nunca no worker.** `DOCUMENT_ENCRYPTION_KEY` só existe na web (runbook de bootstrap), e sem
  ela as chaves da Pluggy não abrem. A rodada usa o contexto de quem guardou a chave, como se a pessoa tivesse
  clicado.
- **Dois gatilhos.** Quando a pessoa abre o sistema, depois de a tela ser entregue (`after`), no máximo a cada
  6 horas por conexão. E quando o Paperclip acorda o agente `bancos` em `POST /api/ops/agents`, que percorre
  todas as conexões com a atualização ligada e deixa só contagens em `ops.agent_runs`. Marcar a hora da rodada
  é a primeira escrita, então duas telas abertas juntas não rodam duas vezes.
- **Exceção à regra 7, decidida pelo fundador.** Aqui lançamento entra sem aceite. O que segura: linha que já
  entrou é pulada; o que a família digitou à mão é respeitado; conta prevista leva baixa em vez de ganhar uma
  cópia; linha sem pista de categoria entra marcada para revisar, e o agente de categorias cuida dela. Cada
  rodada de conta vira um lote em Importar extrato, com o relatório e o Desfazer de sempre.
- **Cartão** entra pela mesma gravação da conferência. Compra de cartão não tem lote: desfaz-se apagando a
  compra.
- **O que não é automático.** Investimentos, porque a posição pede o preço pago. Conta em moeda diferente da
  principal, porque a conversão é conferida na tela. Criar conta e cartão, que continuam num clique da pessoa.
- **Desligar.** Cada conexão tem o interruptor "Atualização automática", e o painel tem o do agente `bancos`,
  que para os dois gatilhos.

## Saldo das contas ligadas (2026-11-11)

No primeiro uso real, todas as contas ligadas apareceram negativas. A conta criada a partir do banco nasce com
saldo inicial zero e só recebe os lançamentos da janela trazida: a soma era a dos gastos do período, e não o
dinheiro que a pessoa tem.

- **O banco é a referência.** A Pluggy informa o saldo de cada conta (`balance`). Depois de cada rodada, de
  "Atualizar", de ligar ou criar a conta e de uma importação pela conferência, o saldo inicial da conta daqui é
  acertado para que saldo inicial mais lançamentos dê o saldo do banco (`alignBankBalances`). Os lançamentos
  não mudam. Fica na auditoria, como alteração da conta.
- Vale também para conta que já existia e foi ligada: enquanto ligada, o saldo dela é o do banco.
- Em cartão, `balance` é o valor da fatura e nunca vira saldo. Sem saldo na resposta, nada muda.
- **Cartão criado a partir do banco** sugere como conta que paga a fatura a conta da mesma instituição já
  ligada, e não a primeira conta da família: a fatura confirmada estava saindo da conta errada.
- **Operações em bolsa** liquidadas na conta ("OPERAÇÕES EM BOLSA … NOTA Nº") entram como aporte na compra e
  como resgate na venda, e não como despesa ou receita.

Não resolvido aqui: transferência entre duas contas ligadas da mesma família entra como despesa numa e receita
na outra; e a fatura paga em mais de um pagamento no mesmo mês.

## Conexão de outra aplicação (2026-11-11)

O painel da Pluggy tem um botão "Iniciar Demo" no topo que é da aplicação de exemplo, a Pluggy Demo App, e não
da aplicação que a pessoa criou. A conexão feita por ele existe, mas pertence a outra aplicação: com as chaves
da aplicação da pessoa, `/accounts` devolve lista vazia, sem erro. Foi o que travou o primeiro teste. Agora cada
Item ID é conferido em `/items/{id}` antes de salvar, e a conexão de outra aplicação é recusada com a
explicação. O guia avisa para usar o ▶ da linha da própria aplicação.

## Fora desta etapa

- Fundos, renda fixa e previdência: aparecem como ignorados na conferência, com o motivo.
- Gravar as compras e vendas uma a uma: o histórico só serve para o preço médio da posição.
- Estorno e crédito na fatura do cartão.
- O conector embutido (Pluggy Connect), que dispensaria copiar o Item ID.

## Se o OrganizeUp contratar o plano de produto

A leitura, o mapeamento (`packages/domain/src/bank-feed.ts`) e a conferência servem do mesmo jeito. Muda só de
onde vêm as chaves: da aplicação do OrganizeUp, e não da pessoa.
