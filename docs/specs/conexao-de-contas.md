# Conexão com bancos e investimentos: caminho mais barato

Pedido do fundador em 2026-11-01: o usuário conecta contas reais de banco e de investimentos, com autorização dele, do
jeito mais barato possível. Pesquisa feita na mesma data. Não substitui advogado. Preços da Pluggy e da B3 conferidos
direto na fonte; o resto está marcado.

## Conclusão

| Etapa                     | Quando                                    | Custo fixo   |
| ------------------------- | ----------------------------------------- | ------------ |
| 1. Importar arquivo       | Agora                                     | R$ 0         |
| 2. API da B3              | Com CNPJ e 51 assinantes de Investimentos | R$ 500/mês   |
| 3. Open Finance de bancos | Com 126 famílias dispostas a pagar        | R$ 2.500/mês |

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
- O investidor autoriza na área logada da B3 e revoga lá. Não traz caixinhas de banco.

## Etapa 3: Open Finance de bancos

Pluggy é o único piso público confirmado: mínimo de R$ 2.500 por mês até 500 conexões, Open Finance incluído na lista do
plano, 15 dias grátis. Acima de 500 conexões o preço é sob consulta.

- Com 2 conexões por família, R$ 2.500 cobrem 250 famílias: R$ 10 por família no teto e R$ 25 com 100 famílias.
- Complemento de R$ 9,90 não fecha. R$ 19,90 empata com 126 famílias e é o preço a testar.
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
