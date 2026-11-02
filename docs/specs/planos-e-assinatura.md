# Especificação — plano montado pelo cliente e assinatura

Pedido do fundador em 2026-11-01: o cliente define e monta o próprio plano, vê o valor mensal e o que libera enquanto
escolhe, e dentro do sistema faz upgrade, downgrade e cancelamento. Pesquisa de preços e da Stripe feita na mesma data.
Decisões duráveis vão para o ADR-0023.

## 1. Modelo

Base obrigatória mais módulos que a pessoa liga e desliga, com o total mudando na hora. O pacote **Família completa**
já vem marcado, e desmarcar um módulo mostra o preço cair. Motivo: a pesquisa não achou evidência a favor de montagem
totalmente livre, e o risco de travar na escolha é maior em quem ainda não conhece o produto; base, complementos e
pacote padrão são o que concorrentes próximos usam (Status Invest, Meu Dinheiro). Isso ainda é o cliente montando o
plano, sem o custo de começar do zero.

A assinatura é da **família**, sem cobrar por pessoa: Monarch e YNAB também incluem a casa toda.

Pedido do fundador na mesma data: começar bem barato e subir com o uso, com um campo que a pessoa vai aumentando,
cobrando por moeda adicional, lançamentos e mensagens.

**Base, com campo de lançamentos por mês.** Inclui contas, cartões, categorias, extrato, calendário, reserva e
relatórios.

| Lançamentos por mês | Mensal   |
| ------------------- | -------- |
| Até 50              | R$ 9,90  |
| Até 200             | R$ 19,90 |
| Sem limite          | R$ 29,90 |

**Módulos.**

| Módulo          | Mensal  | O que libera                                 |
| --------------- | ------- | -------------------------------------------- |
| Investimentos   | R$ 9,90 | Carteira, cotações, proventos, balanceamento |
| Aposentadoria   | R$ 9,90 | Plano por proventos, Seu plano               |
| Dívidas         | R$ 7,90 | Agente de dívidas, anexos, importar arquivo  |
| Metas e viagens | R$ 6,90 | Metas com parcelas, viagens sugeridas        |

**Assistente com IA, com campo de mensagens por mês.** Inclui dicas por tela, memória e categorias com IA.

| Mensagens por mês | Mensal   |
| ----------------- | -------- |
| 30                | R$ 6,90  |
| 100               | R$ 14,90 |
| 300               | R$ 29,90 |

**Moeda adicional:** a moeda principal é grátis, e cada outra custa R$ 4,90 por mês.

**Contas conectadas:** R$ 19,90 por mês, por conta conectada, escolhido num campo de quantidade na montagem do plano,
como lançamentos e mensagens. Decisão do fundador em 2026-11-01; o porquê do preço está em
[conexao-de-contas.md](conexao-de-contas.md). É item com quantidade e cobrança mensal recorrente, por cima de qualquer
plano, sem preço anual. **Nasce fora de venda, invisível ao cliente e impossível de comprar, até a conexão com bancos
existir.**

**Família completa, R$ 44,90:** lançamentos sem limite, todos os módulos e 100 mensagens. Vem marcada. Em cima dela, a
pessoa ainda pode aumentar mensagens e somar moedas. O caminho mais caro no avulso soma R$ 103,40, com duas moedas.

Anual: 2 meses de desconto. Família completa anual: R$ 449,00. Valores são **hipótese**: concorrentes vão de R$ 19,90
(Investidor10) a R$ 79 (Organizze Plus). Ficam editáveis no admin, e preço novo não muda quem já assina.

### Regras dos campos

- Cada degrau é um preço fixo da Stripe, não cobrança por consumo: a pessoa sabe o valor antes, e a pesquisa mostrou
  incômodo com conta que sobe. Trocar de degrau segue as regras de upgrade e downgrade.
- **Conta como lançamento** só o que a pessoa lança ou importa. Não contam parcela, fatura, aporte, recorrência nem nada
  gerado pelo sistema.
- **Bater o limite nunca apaga nem bloqueia leitura.** Aviso em 80% do limite. Ao passar, o que já existe continua
  funcionando, e novos lançamentos manuais e importações pedem para subir de degrau. Uma importação que passa do limite
  mostra quantas linhas cabem antes de gravar, e nunca fica pela metade.
- **Mensagem** é uma pergunta da pessoa ao assistente. Dicas da madrugada e categorias com IA não gastam mensagem.
  Acabou no mês, a conversa pausa até o mês virar ou subir de degrau. O resto segue normal.
- **Custo de IA:** medido em 2026-11-01, cerca de US$ 0,003 por chamada ao modelo no Haiku 5.5, em poucas chamadas. Uma
  pergunta faz de duas a três. Estimativa: até R$ 0,05 por mensagem, então 300 mensagens custam até R$ 15. Conferir com
  uso real em `ai_usage` antes de abrir ao público. O teto por família continua valendo como proteção.
- **Moeda adicional:** só libera criar conta naquela moeda. Quem cancela mantém a conta e o histórico, só leitura.

## 2. Teste e fim do teste

- **7 dias sem cartão, com tudo liberado.** É o único período com experimento aleatório forte a favor, em SaaS.
- Sem plano grátis. Fim do teste sem assinatura: só leitura. A família continua vendo e exportando os próprios dados,
  e nada é apagado.
- Módulo desligado: a tela vira convite com o que ele faz e o preço. Dados ficam guardados e voltam ao religar.
  Agentes e IA de módulo desligado não rodam, o que reduz custo.

## 3. Trocas no sistema

- **Upgrade:** vale na hora, cobrando a diferença proporcional, com a prévia do valor antes de confirmar.
- **Downgrade:** vale no fim do ciclo pago, e a tela mostra o que muda e quando.
- **Cancelar:** um clique, sem retenção forçada. Vale até o fim do período pago.
- **Arrependimento:** devolução integral nos 7 dias da primeira cobrança (CDC, art. 49), inclusive no anual.
- **Renovação anual:** aviso 30 dias antes.

## 4. Stripe

- Cada módulo é um produto, com preço mensal e anual em BRL. Família completa é produto próprio, não cupom. Uma
  assinatura com vários itens, num só intervalo.
- Tela de plano própria: o Customer Portal não altera assinatura com vários produtos e não mexe em assinatura com
  mudança agendada. Portal fica só para cartão e faturas.
- Upgrade com `always_invoice` e prévia por `create_preview`. Downgrade por `subscription_schedules`.
- Webhook é a fonte da verdade, gravado em tabela local, idempotente por id do evento. O acesso lê a tabela local, sem
  chamar a Stripe a cada tela.
- Cartão mensal e anual. Boleto só no anual, porque custa 12% de R$ 29,90 e não aceita reembolso pela Stripe.
- Stripe Tax não cobre o Brasil e a Stripe não emite nota.

## 5. Acesso

Uma função só, `canUse(module)`, no servidor, em toda tela, action, rota e ferramenta da IA, e nos agentes. A tela
esconder botão não é proteção. Admin concede cortesia por família. Famílias que já existem entram com cortesia, e o
fundador decide quando acaba.

## 6. Chave de liberação

`billing_enabled` em `ops.feature_flags`, desligada. Desligada, todos têm acesso como hoje, e a tela de planos fica
visível só para o admin. O sistema mostra se a chave da Stripe é de teste ou de produção, sem nunca mostrar o valor.

## 7. Antes de cobrar de verdade

1. CNPJ, CNAE e regime, com o contador.
2. Emissão de NFS-e. O app da NFE.io emite para faturas pagas na Stripe.
3. Termos com cobrança, renovação, cancelamento e devolução, com advogado. Inclui perguntar sobre sugestões de
   investimento por IA e a CVM, porque agora há cobrança por esse recurso.
4. Resposta por escrito da Stripe: parcelamento, acesso ao Pix e cobrança em dólar e euro. Sem parcelamento, o anual
   compete pior: concorrentes vendem em 12x.
5. Plano pago da brapi: o grátis é descrito para protótipos sem receita.

## 8. Fases

1. Catálogo, tela de montar o plano e `canUse`, com a chave desligada.
2. Assinatura em modo de teste da Stripe, webhook e tabela local.
3. Upgrade, downgrade, cancelamento e devolução.
4. Admin, ver a seção 9.
5. Liberação, depois da seção 7.

## 9. Admin

Pedido do fundador: o painel acompanha tudo isso, com mais gerência e controle de usuários VIP.

- **VIP:** marcar família ou pessoa como VIP, com o que ela recebe (tudo liberado ou módulos e limites escolhidos),
  motivo, validade opcional e quem concedeu. Pode ser sem custo ou com desconto. Lista de VIPs com filtro e aviso antes
  de vencer. VIP não passa pela Stripe quando é sem custo. Toda concessão e remoção fica na auditoria.
- **Assinaturas:** por família: plano, módulos, degraus, valor, próxima cobrança, situação, histórico de trocas, sem
  dado financeiro da família. Ações: conceder dias de teste, cortesia, cancelar, devolver e reenviar cobrança, com
  confirmação e auditoria.
- **Catálogo:** editar preço, degraus e módulos, ligar e desligar módulo à venda. Preço novo vale para quem assinar
  depois, e cria preço novo na Stripe.
- **Receita:** receita mensal recorrente, assinantes ativos, em teste, em atraso, cancelamentos, módulos mais
  assinados, ticket médio, conversão do teste e custo de IA contra receita por degrau.
- **Uso:** famílias perto do limite de lançamentos e mensagens, em contagens.
- **Chave:** `billing_enabled`, situação da chave da Stripe (teste ou produção) e do webhook, último evento recebido e
  erros de cobrança.
- **Telas novas:** relatórios, moeda principal, notificações e agentes `dividas` e `relatorios` entram nos blocos de
  agentes, família e sistema. Dívidas e Relatórios entram no catálogo da equipe do Paperclip.
