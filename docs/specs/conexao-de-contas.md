# Conexão com bancos e investimentos: caminho mais barato

Pedido do fundador em 2026-11-01: conectar contas reais de banco e de investimentos, de CPF e de CNPJ, inclusive de
familiares e sócios, com a aprovação do titular de cada conta, do jeito mais barato possível. Pesquisa feita na mesma
data. Não substitui advogado. Preços da Pluggy e da B3 conferidos direto na fonte; o resto está marcado.

## Conclusão

| Etapa                     | Quando                                    | Custo fixo   |
| ------------------------- | ----------------------------------------- | ------------ |
| 1. Importar arquivo       | Agora                                     | R$ 0         |
| 2. API da B3              | Com CNPJ e 51 assinantes de Investimentos | R$ 500/mês   |
| 3. Open Finance de bancos | Com 253 conexões pagas confirmadas        | R$ 2.500/mês |

## Quem conecta e quem aprova

Regra central: **quem aprova é sempre o titular da conta no banco, nunca outra pessoa da família ou da empresa.**

- Cada pessoa conecta as próprias contas, de CPF, no próprio login. Ninguém conecta a conta de um familiar ou de um
  sócio no lugar dele.
- Outra pessoa pode **pedir** a conexão: o sistema manda um convite ao titular, e ele entra no banco e aprova. Quem pediu
  não vê a senha, nem o processo, nem nada antes de aprovar.
- Conta de CNPJ é aprovada por quem tem poder no banco para representar a empresa. Isso é do banco: o sistema só pede o
  CNPJ, e a pessoa autoriza no ambiente da empresa.
- Criança e quem não tem login não conectam. Conta de menor fica de fora nesta fase; validar com advogado.
- Conta conjunta: o titular que aprovou responde pela conexão. Aviso disso na tela; validar com advogado.
- O titular escolhe se a família ou os sócios veem os dados daquela conta, e pode revogar sozinho, a qualquer momento.
  Quem pediu não revoga pelo titular, salvo tirar a conta da visão da família.
- Quem sai da família ou da empresa tem as conexões encerradas, e os dados dele deixam de aparecer para os demais.
  O que acontece com o histórico já importado precisa de decisão antes de construir.
- Na tela, cada conta mostra de quem é. Lançamentos conectados entram como vindos daquele titular.

## Etapa 1: importar arquivo

Extrato OFX e CSV já existe em `/app/importar`. Falta importar o Excel da Área do Investidor da B3 e a nota de
corretagem. O arquivo é baixado pelo próprio titular, sem contrato com banco ou B3, e é o caminho mais estável.

## Etapa 2: API da B3

Fonte: Manual Técnico das APIs da Área do Investidor, seção 8, revisão de 10/06/2026, e `developers.b3.com.br`.

- Modelo Consulta de Informações: piso de R$ 6.000 por ano, cobrado a R$ 500 por mês. Até 10.000 investidores
  autorizados, a tarifa por CPF é zero. Acima disso entra a tabela por faixa.
- Modelo Distribuidor de Dados e Profissional Especializado: R$ 3 mil por mês fixos mais tabela. **Confirmar com a B3**
  qual modelo vale para um produto com assistente de IA.
- Só pessoa jurídica. Exige contrato, self-assessment e avaliação no Security Scorecard, e a B3 pode recusar.
- Dados até D-1: posição, movimentação, negociação, eventos e Tesouro Direto.
- O investidor autoriza na área logada da B3 e revoga lá. Cada CPF ou CNPJ conta como um investidor autorizado. Não traz
  caixinhas de banco.

## Etapa 3: Open Finance de bancos

Pluggy é o único piso público confirmado: mínimo de R$ 2.500 por mês até 500 conexões, Open Finance incluído na lista do
plano, 15 dias grátis. Acima de 500 conexões o preço é sob consulta. A lista de instituições traz contas Personal e
Business, entre elas Itaú, Bradesco, Caixa, Santander, Banco do Brasil, Nubank, Inter, C6, Sicoob e Sicredi, e o fluxo
pede CPF ou CNPJ conforme o tipo. O link de consentimento vale uma vez só, então o convite ao titular deve ir de um jeito
que apps de mensagem não abram antes dele.

- **Cobrar por conexão, não por família:** família ou empresa com vários titulares pode ter muitas contas. No teto do
  plano, cada conexão custa R$ 5. A R$ 9,90 por conexão, com o campo que a pessoa vai aumentando, o piso se paga com 253
  conexões, e 500 conexões rendem R$ 4.950. Hipótese de preço, a testar.
- Confirmar com a Pluggy se conexão de CNPJ custa o mesmo que a de CPF.
- Open Finance direto, sem agregador, exige ser instituição autorizada pelo Banco Central: inviável neste estágio.
- Não usar conector por senha do banco: depende da senha do usuário e quebra quando o banco muda.

### Risco regulatório

A Resolução Conjunta 21, de 22/10/2026, cria a figura de **entidade parceira** para quem recebe dados de Open Finance por
contrato: consentimento específico por parceira e atestado anual de auditor registrado na CVM. Quem atua só como
operador da LGPD fica de fora; o OrganizeUp decide a finalidade, então tende a ser parceira. **Validar com advogado.**
O custo do auditor não foi confirmado, e o manual da entidade de governança estava previsto para 17/11/2026.

Antes de assinar, pedir por escrito à Pluggy: se o OrganizeUp é entidade parceira, quem paga o auditor, se os R$ 2.500
incluem os conectores regulados, e o preço acima de 500 conexões.

## Regras quando for construir

- Nunca guardar senha de banco. Guardar só o identificador da conexão, cifrado, isolado por família.
- Revogar apaga a conexão e para a coleta. O prazo de consentimento segue a finalidade: não há mais teto fixo de 12 meses.
- Coleta só no worker, fora de `withHousehold`, em job próprio (regra 9).
- Política de Privacidade atualizada antes da primeira conexão.
- Conexão é complemento pago, com `canUse`, para o custo acompanhar a receita.
