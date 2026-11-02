# ADR-0023 — Planos e assinatura

Status: aceito (2026-11-01). Pedido do fundador. Fases 1, 2 e 3 de `docs/specs/planos-e-assinatura.md`, que é a fonte da
verdade de preços, regras e fases. Aqui ficam as decisões de como isso foi feito.

Soma ao ADR-0002 (isolamento), ao ADR-0015 (agentes), ao ADR-0016 (painel e chaves do sistema), ao ADR-0018 (assistente) e ao
ADR-0020 (moedas). **Nenhuma cobrança real é possível nesta versão:** `billing_enabled` nasce desligada, e chave de produção é
recusada sem `STRIPE_ALLOW_LIVE=true`, que só o fundador define.

## Decisão

### Ordem do deploy

O primeiro commit é só a migração `0036` e as linhas de `applyGrants`, e vai a produção antes do resto. As duas coisas andam juntas
porque, sem os grants, `ou_app` herda o GRANT geral sobre `billing_catalog`. Esse commit, sozinho, deixa o `pnpm check` vermelho num
teste, o que confere se toda tabela com `household_id` entra na exportação: o código que as exporta vem no commit seguinte.

Todo o resto funciona com o worker atrasado, com a chave desligada e o banco ainda na `0035`, e `atraso.integration.test.ts`
prova isso como `ou_app`:

- **`usage_month` fica fora de `transactions` e `card_purchases` no Drizzle.** Todo `select()` leria a coluna, e a web cairia no primeiro
  lançamento. `transactionUsage` e `cardPurchaseUsage`, mesmas tabelas, são as únicas que a citam, como `userAccess` no ADR-0016.
- **Chave desligada não marca nem conta nada.** Marcar é um `UPDATE` depois de gravar, só com `mode` diferente de `livre`. Como a chave
  só existe depois da migração, chave ligada garante as colunas. Isso vale para lançamento, importação e mensagem.
- **Exportar lê as tabelas novas num savepoint:** sem elas, saem vazias, e o resto da exportação segue.
- **Webhook sem `ops.billing_events` responde 500,** e a Stripe repete. Fila ainda não criada é só um aviso perdido.

### Três tabelas e uma fila

- **`billing_catalog`, global.** Preço não é editado: preço novo é linha nova, com `on_sale`, e a antiga fica, porque quem
  assinou por ela continua nela. Todos leem; só `ou_admin` grava. `stripe_price_id` chega pelo script
  `apps/web/scripts/stripe-criar-precos.ts`, que por padrão só mostra o que faria. A migração traz os valores da
  especificação, então a tela funciona sem nenhuma variável de id de preço.
- **`household_subscriptions`, 1:1 com a família.** É o espelho do que a Stripe diz. A leitura tem RLS comum; a escrita só
  aceita `ou_worker` com papel `system`. **Nem o responsável grava o próprio plano**, e `ou_app` nem tem o grant. Guarda só ids,
  datas, códigos e os itens com o preço de quando entraram.
- **`household_usage`, mensagens do mês.** Lançamentos não ficam aqui: ver "Limites".
- **`ops.billing_events`, a fila.** Uma linha por id de evento da Stripe, sem PII.
- **`ops.billing_checkouts`, o pagamento aberto.** Cliente da Stripe, sessão e trava, por família: a web não grava no plano, e
  precisa guardar isso em algum lugar antes do webhook.

### Quem grava: a web guarda, o worker aplica

A web recebe o webhook, mas não pode gravar na tabela de uma família sem sessão: isso pediria `ou_admin` numa rota pública, ou
um papel `system` que a RLS só aceita de `ou_worker`. Então:

1. `/api/webhooks/stripe` confere a assinatura, extrai a lista fechada de campos (`normalizeEvent`) e faz `insert ... on conflict
do nothing` em `ops.billing_events`. A chave primária é o que torna o webhook idempotente.
2. Acorda a fila `billing-events`. Falhar aqui não falha o webhook: a mesma fila roda a cada minuto, e essa passada é o que
   garante que nada se perde.
3. O worker aplica em ordem de `stripe_at`, uma família por transação, com `fromJob`.

O preço é até um minuto de atraso quando o aviso falha, e alguns segundos no caso normal. A tela diz "estamos ligando o plano".

**Actions não gravam o plano.** Upgrade, cancelamento e devolução chamam a Stripe e devolvem; o estado muda quando o evento
chega. Há um teste para isso. Assim só existe uma fonte da verdade, e a Stripe nunca é chamada dentro de `withHousehold`.

### Eventos fora de ordem

- **`last_event_at`:** evento de assinatura mais velho que o último aplicado não muda nada.
- **Empate no mesmo segundo vai por precedência de situação.** O horário da Stripe é em segundos, e o id não tem ordem. `canceled`
  ganha de tudo, `incomplete` nunca sobrescreve assinatura que cobra, e `canceled` não volta, nem em evento mais novo. Entre iguais,
  vale o último aplicado.
- **Schedule:** `schedule_event_at` guarda o último evento dele, e `schedule_ended_id`, o último que acabou. Schedule encerrado não
  ressuscita. O `created` nasce sem a fase seguinte: `next: null` no mesmo segundo não apaga o `next` do `updated`, e a assinatura
  sem schedule no mesmo segundo também não.
- **Outra assinatura da mesma família:** o `canceled` atrasado da antiga não derruba a nova. Só entra a que cobra, e no lugar de
  uma que acabou. **Segunda assinatura paga não entra, e fica sinalizada:** evento fechado com `assinatura_duplicada`, log de erro
  e contagem em `adminBillingSummary`, porque a Stripe está cobrando duas vezes.
- **Sem família:** `charge.refunded` não traz metadata. A família sai do `customer_id` de eventos anteriores, em
  `ops.billing_events`; sem isso, a tabela de assinaturas exigiria varrer famílias, o que a RLS não deixa.
- **Preço que o catálogo não conhece** não libera nada: o evento espera. Depois de 60 passadas, fecha com
  `preco_desconhecido`, sem aplicar. O painel da Fase 4 mostra as contagens. Cancelamento não espera: acabar não depende do preço.
- **Sem conserto fecha na hora:** família apagada e id de outra família não esperam 60 passadas.
- **Família sem linha** não perde a cortesia por causa de um evento de fatura: a linha nasce com `sem_linha`.

### Quem entra com cortesia

Gatilho `AFTER INSERT` em `household`, `SECURITY DEFINER`, porque a família nasce sem contexto de tenant, pela conexão do Better
Auth. Com a chave desligada, a linha nasce com **cortesia**; ligada, com **teste de 7 dias**. A migração dá cortesia a quem já
existe. Assim toda família que existe antes de ligar a chave entra com cortesia, inclusive as criadas entre a migração e a
liberação, sem nenhuma rotina a lembrar no dia. `courtesy_until` é o que o fundador usa para decidir quando acaba (Fase 4).

O gatilho não pode impedir cadastro: erro vira aviso no log do banco. Sem a linha, `resolveAccess` dá tudo: erro nosso não vira
bloqueio nem cobrança. Trigger porque o dono da tabela pode não ter `BYPASSRLS`: a política `household_subscriptions_seed` é só
dele, por `TO CURRENT_USER`.

### Acesso: uma função só

`resolveAccess`, pura, em `packages/domain/src/plans.ts`, é a regra. `readFamilyAccess` é a leitura única de web, worker e
assistente. Com a chave desligada nem lê a assinatura: `livre`, todos como hoje.

- **`canUse(access, módulo)`** pode agir: gravar, rodar agente, chamar a IA.
- **`canView(access, módulo)`** pode abrir a tela. Difere em `leitura`: quem só lê continua vendo tudo o que é da família.
- **Só leitura reaproveita a manutenção.** `requireTenant` devolve `readOnlyContext`, então `canWrite()` responde não em todas as
  actions e a RLS recusa o resto. Nenhuma tela precisou mudar.
- **`requireOwnData` é para o que é da pessoa, com ou sem plano:** exportar, apagar memória e conversa, desligar o assistente. Usa
  o papel de verdade, porque em só leitura o contexto vira `viewer`, que nem vê a auditoria. Manutenção vale igual: nela ninguém
  escreve, e exportar volta a responder 403, como antes. `requireTenant` devolve `role`, que no só leitura do plano é o de verdade,
  para a tela de assinar.
- **`requireModule(módulo)`** é o `requireTenant` das actions e rotas de módulo. Com o módulo desligado, devolve contexto só
  leitura: é uma linha por action, sem ramo novo, e o que escapar a RLS recusa. Rota que devolve dado confere `allowed`, porque
  ler a RLS deixa. `moduleInvite(módulo)` é a primeira linha de cada tela.
- **`plan-guard.test.ts`** percorre as pastas do painel, as rotas de `/api` e as ferramentas: coisa nova sem classificação
  reprova. `AssistantTool.module` é obrigatório no tipo.
- **`/app/assinatura`, e não `/app/plano`:** o endereço já é de "Seu plano", o plano financeiro.

| Módulo        | Telas e actions               | Agentes                    | Ferramentas                                |
| ------------- | ----------------------------- | -------------------------- | ------------------------------------------ |
| Base          | o resto, inclusive relatórios | `categorias`, `relatorios` | leitura geral, lembrete, memória           |
| Investimentos | `investimentos`, `proventos`  | `investimentos`, mercado   | `ver_carteira`, `ver_proventos`            |
| Aposentadoria | `aposentadoria`, `plano`      | `aposentadoria`            | `ver_plano_*`, simular guardar e antecipar |
| Dívidas       | `dividas`, anexos             | `dividas`                  | `ver_dividas`, `ver_plano_dividas`         |
| Metas         | `metas`, `viagens`            | `metas`, `viagens`         | `listar_metas`, `listar_viagens`, metas    |
| Assistente    | conversa, ativar, nível       | `categorias_ia`, dicas     | todas as outras dependem dele              |

- **Metas sem Aposentadoria:** metas e viagens dependem da divisão do que sobra, que nascia dentro do agente de aposentadoria.
  `currentAllocation` calcula a mesma coisa sem gravar nada, para o módulo Metas funcionar sozinho.
- **Mercado:** família sem Investimentos não pede cotação. Índices e câmbio seguem, porque são globais.
- **Ler arquivo de dívida é do módulo Dívidas**, não do assistente. O portão é o mesmo, com `module: "dividas"`, sem gastar
  mensagem. Ainda precisa do aceite da família e da chave de IA.
- **Relatório antigo de módulo desligado** fica guardado, mas `relatorios_do_dia` e `ver_relatorio` não falam dele.
- **Apagar memória e desligar o assistente não dependem do módulo.** É direito da pessoa (LGPD).

### Limites

- **Lançamentos: `usage_month` em `transactions` e `card_purchases`,** preenchida só por `saveEntry` e `commitImport`. Parcela,
  fatura, aporte, recorrência e o que o sistema gera ficam nulos, então contar é uma consulta só, sem classificar nada depois.
  Importar operação de investimento (ADR-0024) é aporte, não lançamento, e não conta. Marcar para repetir só não conta enquanto é
  previsão: já pago, conta, e no limite nem a previsão é gravada.
  Apagar ou desfazer a importação devolve a vaga sozinho, sem contador a manter.
- **Mês de criação, no fuso da família,** não o mês do lançamento: senão lançar no passado escaparia do limite.
- **Uma compra parcelada conta uma vez.** Transferência entre contas não conta: não é lançamento na tela de lançamentos, e a
  especificação manda contar só o que ela lista. Dar baixa pelo extrato em algo previsto também não.
- **Concorrência: `pg_advisory_xact_lock`, por família,** só em quem tem limite. Conta depois da trava, grava na mesma transação.
  Sem limite não trava.
- **Importação conta depois de gravar,** com a trava pega antes, porque linha repetida não entra. Passou do limite, lança e a
  transação inteira volta: sem linha, sem lote, sem categoria nova. Isso é o que garante "nunca fica pela metade". A tela já
  avisa antes, com `room`, e não deixa enviar.
- **Mensagens: contador em `household_usage`,** por `INSERT ... ON CONFLICT DO UPDATE ... WHERE messages < limite`: a linha trava, e
  a segunda conversa na última vaga não passa. Contador, e não contagem das conversas, porque conversa é de cada pessoa na RLS e
  apagar uma não pode devolver a mensagem.
- **A mensagem é gasta em `prepare`, uma vez por pergunta,** antes de chamar o modelo. Dentro do loop a conferência é pulada:
  senão a pergunta que usou a última vaga pararia no meio. Chamada que falha devolve a mensagem. Dicas, categorias com IA e o
  parágrafo dos relatórios nem passam por aí; continuam sob o teto do serviço (ADR-0018).
- **Mês do calendário,** não ciclo de cobrança: é o que a especificação diz ("até o mês virar").

### Stripe

- **SDK `stripe` em versão exata, só na web.** O worker nunca fala com a Stripe. Toda chamada passa por `lib/billing/gateway.ts`,
  que é o que os testes trocam pelo cliente falso.
- **Chave:** `stripeKeyMode` diz `ausente`, `teste`, `producao` ou `invalida`, nunca o valor. `billingGateway` recusa produção sem
  `STRIPE_ALLOW_LIVE=true`, e `billingActor` recusa antes. Evento de produção sem a variável responde 503: a Stripe repete por dias.
- **Com a chave desligada, só admin e só com chave de teste** assina, para dar para testar antes de liberar.
- **Só o responsável assina,** pelo papel de verdade: em só leitura o contexto é `viewer`.
- **Metadata leva só `household_id`,** na assinatura, na sessão e no schedule, mais o percentual do desconto VIP (ADR-0025). Quem
  digita e-mail e cartão é a pessoa, na Stripe.
- **Checkout da Stripe para assinar; tela própria para trocar.** `allowed_payment_method_types`: o parâmetro antigo saiu da API.
- **`planChange` separa o que sobe do que desce.** O que sobe vale agora; o que desce, no fim do ciclo. Quem soma um módulo e tira
  outro recebe o novo já e perde o antigo só depois do que pagou. Vale pelo que libera, não pelo preço: sair da Família completa é
  redução, mesmo quando o avulso custa mais. Mensal para anual é subida; anual para mensal espera o ano.
- **Upgrade:** `proration_behavior: always_invoice`, `payment_behavior: error_if_incomplete`, para cartão recusado não dar o
  upgrade, e a mesma `proration_date` da prévia por até 10 minutos, para cobrar o valor que a tela mostrou.
- **Downgrade:** `subscription_schedules`, com `from_subscription` e `end_behavior: release`. Com schedule ativo, a próxima fase
  desfaria o que mudar agora: solta antes e marca de novo.
- **Item que continua não é tocado:** `itemDiff` só manda o que entra e sai. É isso que mantém o preço antigo.
- **Mensal para anual vale inteiro na hora:** cobra só o plano pedido, e o que sobrou do mês vira crédito. Guardar o que sai para
  "depois" cobraria um ano de um módulo que a pessoa tirou. A prévia diz o que sai agora e a próxima cobrança, daqui a um ano.
- **Uma assinatura por família.** O cliente nasce antes do pagamento, com chave idempotente, e fica em `ops.billing_checkouts`. A
  Stripe é chamada fora de transação, então a trava é uma linha, com um minuto de validade. Antes de abrir outro pagamento, confere
  se o cliente já tem assinatura viva, porque o webhook pode estar a caminho, e expira a sessão anterior.
- **Upgrade recusado não perde a redução marcada.** Solta o schedule, tenta, e se falhar marca de novo a mesma fase. Cancelar também.
- **Devolução:** encerra primeiro, depois devolve todas as cobranças desde a primeira. Cair no meio não deixa assinatura ativa de
  quem recebeu o dinheiro, e repetir conclui: a action aceita assinatura já encerrada, dentro dos 7 dias. Boleto a Stripe não
  devolve: a tela manda falar com o suporte, nada é encerrado, e a assinatura fica. Ver "Riscos".
- **Apagar conta ou família cancela antes,** nos três caminhos: `closeOwnHouseholds`, `beforeDeleteOrganization` e o painel, que confere
  antes para não cancelar à toa. Falhou na Stripe, a exclusão é recusada, com mensagem. Sem isso a Stripe seguiria cobrando.
- **Portal só para cartão e faturas.** A troca de plano precisa estar desligada na configuração do portal, na Stripe (runbook).

### Preço

- **`quotePlan` é a única conta.** A tela soma no navegador com ela, e `pricesOf`, na action, usa a mesma lista. Um teste de
  propriedade confere que o total é a soma exata dos preços enviados.
- **Valores só por `money`.** A Stripe é a única fronteira em `number`, e sempre inteiro em centavos: `fromCents` e
  `stripeUnitAmount`.
- **Preços em reais para toda família,** mesmo com moeda principal em dólar: `moneyText(valor, "full", "BRL")`. Cobrar em dólar e
  euro depende de resposta da Stripe (spec, seção 7).
- **Moeda adicional é um preço por moeda,** não quantidade: "só libera criar conta naquela moeda" precisa saber qual, e assim o
  webhook sozinho diz, sem metadata. A principal é grátis, e o servidor tira ela da escolha.
- **`familia_mensagens:300`, R$ 15,00 por mês:** a especificação diz que dá para aumentar mensagens em cima da Família completa e
  não diz por quanto. É a diferença entre os degraus de 300 (R$ 29,90) e 100 (R$ 14,90). Fica no catálogo, editável.

### Contas conectadas

Item `contas_conectadas`, R$ 19,90 por mês, por conta (spec, seção 1, e `conexao-de-contas.md`). É o único item com quantidade:
`PlanSelection.connectedAccounts` vai na `quantity` da linha da Stripe, e `itemDiff` muda só a quantidade do item que já existe.
Aumentar vale na hora; diminuir, no fim do ciclo. Nasce com `on_sale = false`, sem preço na Stripe, e o script de preços pula o que
está fora de venda. `readBillingCatalog` não o devolve, então a tela não mostra o campo e `subscribe` responde `catalogo`. Para
abrir a venda, a Fase 4 ou a frente da conexão liga `on_sale` e roda o script: a tela e o cálculo já funcionam. O limite de contas
por família é da conexão: `connectedAccountsOf` diz quantas foram pagas.

**Sem preço anual,** porque a decisão é de cobrança mensal e uma assinatura tem um intervalo só: família no anual não consegue
somar contas conectadas. **Decisão do fundador pendente** antes de abrir a venda.

### Conflitos na especificação

- **"Desmarcar um módulo mostra o preço cair" não vale saindo da Família completa.** Ela custa R$ 44,90, e tudo aquilo no avulso custa
  R$ 79,40. Desmarcar Dívidas dá R$ 71,50: o preço **sobe**. Fazer cair exigiria uma Família sem cada módulo, 32 combinações por
  ciclo na Stripe, ou um cupom, que a especificação descarta. A tela mostra o valor que seria cobrado, diz quanto a Família
  completa economizaria e volta nela com um clique. No avulso, desmarcar sempre baixa, no valor do módulo. **Decisão do fundador
  pendente.**
- **O caminho mais caro no avulso soma R$ 104,20, não R$ 103,40.** As tabelas dão 29,90 + 34,60 + 29,90 + 9,80. O código segue as
  tabelas, e o teste registra o número.

## Fora do escopo por enquanto

Fase 4 (painel): feita no ADR-0025. Fase 5 (liberação), que depende da seção 7 da especificação. E-mail de cobrança: o aviso de renovação
anual e o de cobrança falha ficam na central de notificações, porque o worker não envia e-mail. A Stripe pode mandar os dela,
ligados no painel dela.

## Riscos aceitos

- **Política de Privacidade e Termos ainda não citam a Stripe nem a cobrança.** Com a chave desligada, nenhum dado vai para lá. Tem de
  mudar antes de ligar, com o advogado (spec, seção 7).
- **Aviso de renovação só dentro do app.** Quem não abre o app não vê. Antes de abrir ao público, ligar o e-mail da Stripe ou criar o
  envio pelo worker.
- **Devolução de boleto é manual.** A tela não encerra a assinatura, e o suporte precisa devolver por transferência e cancelar.
- **Até um minuto de atraso** entre o pagamento e o plano, quando a web não consegue acordar o worker.
- **Webhook perdido por mais de um mês** deixa a assinatura como estava: quem pagou não perde acesso, e quem não renovou ganha um
  tempo. Cancelada que passou três dias do fim do período cai sozinha, sem esperar o evento.
- **Cancelar dentro dos 7 dias de teste** devolve a família ao teste até o dia 7. É o que ela já tinha.
- **Várias famílias, vários testes.** Uma pessoa pode criar outra família e ganhar outros 7 dias. Para exigir um teste por CPF
  depois, use o identificador que já existe: a identidade fica em `user_identity` (ADR-0022, cadastro PF/PJ). Ela não entra na
  metadata da Stripe, que continua levando só o id da família.
- **Moeda cancelada** bloqueia gravar na conta, e não editar a conta. Compromisso previsto nela não é confirmado até religar a moeda
  ou trocar a conta.
- **Trigger `SECURITY DEFINER` e o `ops` no meio do cadastro.** É o único ponto do schema assim. Falha vira aviso, não erro.
- **O cliente da Stripe continua lá depois de apagar a família,** com o id da família em metadata e o e-mail que a pessoa digitou no
  pagamento. Apagar o cliente fica para a revisão de LGPD da Fase 5.
- **Valores são hipótese** (spec, seção 1), e o custo de IA por mensagem precisa ser conferido em `ai_usage` antes de abrir ao público.
