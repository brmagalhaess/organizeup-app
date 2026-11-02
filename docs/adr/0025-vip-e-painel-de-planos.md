# ADR-0025 — VIP e painel de planos

Status: aceito (2026-11-02). Pedido do fundador. Fase 4 de `docs/specs/planos-e-assinatura.md`, seção 9, que é a fonte da
verdade do que o painel mostra. Aqui ficam as decisões de como isso foi feito.

Soma ao ADR-0016 (painel) e ao ADR-0023 (planos). **Nenhuma cobrança real é possível nesta versão:** `billing_enabled` segue
desligada, e chave de produção segue recusada sem `STRIPE_ALLOW_LIVE=true`. O que depende da chave de teste real está em "O que
falta conferir".

## Decisão

### Ordem do deploy

O primeiro commit é só a migração `0038` e as linhas de `applyGrants`, pelo mesmo motivo do ADR-0023: sem os grants, `ou_app` e
`ou_worker` herdariam o GRANT geral sobre `vip_grants`, e a família poderia gravar o próprio VIP. Esse commit, sozinho, deixa o
`pnpm check` vermelho no teste da exportação, porque `vip_grants` tem `household_id` e o código que a exporta vem no commit
seguinte. `vip_grants` e `discount_percent` só são lidos com a chave ligada, ou pela conexão do painel, que tolera a tabela
faltando. `readFamilyAccess` lê a concessão num savepoint: sem a tabela, ninguém tem VIP, e o resto da transação segue.

### VIP é uma camada, e não uma mudança no plano

`vip_grants` guarda a concessão, e `household_subscriptions` não muda. `resolveAccess` calcula o plano como antes e, se a
concessão vale agora, soma as duas coisas. Dessa escolha sai quase tudo:

- **Vencer volta ao estado anterior sem apagar nada.** Vencer é `vipActive` deixar de responder sim. Não há rotina, nem linha a
  restaurar, e o teste prova que o acesso depois de vencer é idêntico ao de antes de conceder, em teste, só leitura, assinatura e
  cortesia.
- **Ninguém é cobrado por surpresa.** Acabar a concessão não abre cobrança, porque cobrança só nasce no pagamento da Stripe, que
  a pessoa abre. Quem nunca assinou volta a teste, cortesia ou só leitura, o que tinha.
- **VIP nunca tira o que a família já tinha.** Módulos, limites e moedas somam, e vale o maior limite.
- **`resolveAccess` continua sendo o único que decide.** `vip_grants` traz os dados, e `vipState` só os põe no formato dele. O
  painel usa a mesma função, por `adminFamilyAccess`, em vez de repetir a regra em SQL.

`mode: "vip"` só em concessão sem custo. Ele se comporta como cortesia para as telas, e `canUse` responde pelos módulos.

### VIP de pessoa

**Uma concessão é sempre de uma família.** VIP de pessoa é a concessão a uma família de que ela é responsável (`role = owner`),
presa a ela por `user_id`:

- Vale para **todos os membros** daquela família: a assinatura é da família, e não por pessoa (spec, seção 1).
- **Só o responsável.** Quem é só membro não passa VIP: senão um convite daria acesso à família de qualquer pessoa. O painel
  recusa com `nao_responsavel` e manda marcar a família, se for o caso.
- **Não segue a pessoa.** Família nova dela não ganha nada, e quem é responsável por duas escolhe uma, ou recebe duas concessões.
  Sem isso, uma pessoa VIP abriria quantas famílias quisesse.
- **Deixou de ser responsável, parou de valer,** e a família volta ao que tinha. `holderActive` é lido a cada acesso, então não há
  rotina a lembrar. A lista mostra "Sem responsável". Conta apagada zera `user_id`: a concessão para de valer, e a linha fica.

Isso também é o que mantém `household_id NOT NULL`, como a regra 2 pede. Pessoa sem família de que seja responsável não recebe VIP.

### Sem custo e com desconto

- **Sem custo não passa pela Stripe.** Nenhuma chamada, e nada muda na assinatura.
- **Sem custo com a Stripe cobrando é recusado** (`assinatura_viva`, `willChargeAgain`): a família pagaria pelo que ganhou. Cancele
  antes. Marcada para acabar no fim do período, pode. A mesma regra vale para a cortesia pelo painel.
- **Família VIP sem custo não abre pagamento:** `subscribe` responde `vip`. Se uma assinatura entrar mesmo assim, por um webhook
  atrasado, a lista e a visão geral avisam com `stillCharged`.
- **Desconto sozinho não libera nada.** Só soma enquanto a assinatura paga. Sem assinatura, a família continua no que tinha: desconto
  não é acesso de graça.
- **Desconto é cupom da Stripe, para sempre, um por percentual,** aplicado em `subscribe`, para já entrar na primeira cobrança, ou
  pelo botão em Assinaturas, para quem já assina, sem cobrança proporcional.
- **O preço só sobe por ação explícita.** Vencer ou remover o VIP não toca na Stripe: o worker nem fala com ela, e a web não tem
  quando fazer isso. A família segue pagando menos, a visão geral avisa, e tirar o desconto é um botão que manda avisar a família.
  Errar para o lado de cobrar menos é o que "ninguém cobrado por surpresa" pede.
- **`discount_percent` em `household_subscriptions` é espelho,** e vem da nossa metadata `vip_desconto`, no webhook. A assinatura
  tem `discounts` como ids, sem o percentual, e expandir exigiria outra chamada à Stripe. É isso que a receita desconta. Muda a
  frase do ADR-0023: a metadata leva o id da família e, com VIP, o percentual, nada além.

### Motivo em lista fechada

O motivo é um código de `VIP_REASONS`, e não texto livre. Motivo escrito à mão vira nome de pessoa, e o painel não pode guardar PII
nova (regra 5). "Quem concedeu" é o id do administrador, e a tela mostra só o código curto.

### Quem grava

- `vip_grants` tem RLS com `FORCE`, e uma política só, de leitura da própria família. **`ou_app` e `ou_worker` não têm grant de
  escrita,** e `ou_admin` não tem `DELETE`: remover é marcar `revoked_at`. Em família apagada a cascata vem do dono.
- **`household_subscriptions` agora também é gravada pelo painel,** por `ou_admin`, em dias de teste e cortesia. A assinatura em si
  continua só do worker. Actions do painel que falam com a Stripe não gravam nela: o estado muda pelo webhook, como no ADR-0023.
- **Uma concessão aberta por família,** pelo índice parcial `vip_grants_open_uniq`. Duas concessões ao mesmo tempo: uma entra, a
  outra recebe `ja_vip`. Concessão aberta que já venceu é fechada na mesma transação, com `revoked_by = 'validade'`, para não
  segurar a nova.

### Auditoria

- **O registro entra só quando a ação aconteceu,** na mesma transação. `adminAct`, do ADR-0016, grava antes e registra também a
  recusa. Aqui isso faria uma concessão recusada parecer feita.
- **Ação na Stripe é registrada antes de chamar,** e de novo, com `_falhou`, se falhar. O efeito não cabe na transação, e a
  tentativa precisa ficar mesmo que o processo caia no meio.
- **Nenhum administrador concede à família de que participa,** como no ADR-0016.

### Ações por família

- **`billing_enabled` desligada: Cancelar, Devolver, Reenviar e desconto ficam indisponíveis, com o motivo,** mesmo com chave de
  teste. É o que o pedido diz, e as ações continuam sendo testadas com o cliente falso. Dias de teste e cortesia não usam a Stripe e
  ficam sempre disponíveis.
- **Cancelar é no fim do período pago,** a mesma coisa da família, por `setCancelAtPeriodEnd`.
- **Devolver segue a mesma janela de 7 dias da família.** `refundAndCancel` devolve tudo desde a primeira cobrança: sem a janela, um
  clique devolveria um ano. Fora dela, a devolução é manual, na Stripe. Pede digitar DEVOLVER, e o servidor confere.
- **Reenviar é tentar de novo a última fatura em aberto,** e só com a assinatura em atraso.
- **Histórico de trocas sai de `ops.billing_events`:** data, tipo, situação, itens e valor cobrado. Sem dado de quem pagou.

### Catálogo

- **Preço novo é linha nova,** como o ADR-0023 previa. A antiga sai de venda e fica, com o `stripe_price_id`, e por isso o webhook de
  quem assinou por ela continua achando o preço, e `kept` mantém o valor.
- **A linha nova vai à venda na hora, sem preço na Stripe.** Enquanto isso, quem tenta assinar aquele item recebe `catalogo`, e nada é
  cobrado errado. Duas fases, com o preço antigo à venda até criar o novo, pediriam uma linha "pendente" e um jeito de descartá-la.
  Com a chave desligada não há efeito nenhum, e com ela ligada a tela já mostra o botão ao lado.
- **Criar na Stripe é um clique por preço,** com confirmação. Precisa de chave utilizável, e não de `billing_enabled`, porque os
  preços precisam existir antes de ligar. `stripe-prices.ts` é o mesmo código do script.
- **Degraus vêm do código.** `ENTRY_TIERS` e `MESSAGE_TIERS` são constantes: o painel muda preço e venda de cada degrau, mas degrau
  novo pede deploy, porque `canUse` e a tela de montar o plano dependem deles.
- **`contas_conectadas` não vai à venda, por nenhum caminho do painel:** `conexao_inexistente` no interruptor, sem preço anual, e
  preço novo nasce fora de venda. Quem liberar isso muda a constante, junto com a conexão. Sem `CHECK` no banco: tirar um depois
  seria `DROP`.
- **Mínimo de R$ 0,50,** que é o menor valor que a Stripe aceita em reais.

### Receita

- **`revenueSummary`, pura, em `packages/domain`,** por `money`. Recebe o `mode` que `resolveAccess` decidiu.
- **Receita mensal recorrente é quem está em dia,** com o anual em doze avos e o desconto já fora. Quem está em atraso fica de fora, e
  o valor em risco aparece à parte.
- **Conversão do teste** é, de quem terminou o teste ou pagou antes de ele acabar, quantos pagaram.
- **Custo de IA por degrau** soma `ai_usage` do mês até hoje e compara com a receita das famílias daquele degrau. Dólar da última PTAX
  em `market_fx`; sem cotação, mostra em dólar e não faz a conta. Quem não paga aparece numa linha própria, porque gasta IA.
- **Com a chave desligada, não há número de receita.** A tela diz isso, e mostra só as contagens que existem de verdade. Com chave
  de teste, avisa que os valores são de teste.
- **A tela de assinaturas mostra o que vale com a chave ligada,** com um aviso no topo: desligada, todas estão em `livre`, e isso não
  ajudaria a decidir quando ligar.

### Chave

Ligar pede digitar `LIGAR COBRANCA`, conferido de novo no servidor, com o checklist da seção 7 na mesma tela e o aviso de que
Política e Termos ainda não citam a Stripe. Sem chave utilizável, o servidor recusa. O checklist não bloqueia: o painel não sabe se o
contador foi consultado. Preços sem Stripe aparecem no checklist, e também não bloqueiam, para dar para testar antes de criar todos.
Com chave `sk_live_` ou `rk_live_`, a tela diz com todas as letras que há cobrança real.

### Telas novas no painel

Agentes `dividas` e `relatorios` já estavam em `info.ts`: entrou o horário de Dívidas, e os dois no catálogo do Paperclip. A família
ganhou moeda principal, relatórios, notificações e dívidas, e o Sistema, as mesmas contagens somadas. Só código, datas e números:
nenhuma coluna de texto ou valor é lida. O fim do teste, para o painel, continua sendo Fase 5.

## O que falta conferir, com a chave de teste real

Tudo o que fala com a Stripe só rodou contra o cliente falso:

- Cupom em `subscriptions.update` e em `checkout.sessions.create`, e a metadata chegando no webhook.
- `invoices.pay` em fatura aberta de cartão recusado.
- `createPrice` pelo botão do catálogo, e o evento da assinatura achando o preço novo.
- Cancelar, devolver e o histórico com eventos de verdade.

## Fora do escopo por enquanto

Encerrar a cortesia de todas as famílias de uma vez. Avisar a família antes de o VIP vencer: hoje o aviso é só do painel, e a tela de
assinatura mostra a validade. Adoção de Dívidas no gráfico da visão geral, que pediria coluna nova em `ops.platform_stats`. Degrau
novo pelo painel. Motivo de cada mudança de preço na auditoria: `ops.admin_access` não tem onde, e as linhas do catálogo guardam quando.

## Riscos aceitos

- **Desconto esquecido.** VIP vencido segue com desconto até alguém tirar. A visão geral avisa, e o erro é para menos.
- **Janela sem preço na Stripe** entre salvar um preço novo e criar lá. Quem tenta assinar aquele item recebe recusa.
- **VIP sem custo vencendo tira o acesso de quem não assinou.** Sem cobrança, mas a família fica só leitura se não tiver outro acesso. Ela vê
  a validade na tela de assinatura, e o painel avisa 14 dias antes.
- **O painel lê todas as famílias a cada tela de cobrança,** para passar por `resolveAccess`. Serve enquanto forem milhares.
- **`vip_grants` entra na exportação da família,** com o código do motivo e o id de quem concedeu. É dado sobre ela, e o id não
  identifica ninguém.
