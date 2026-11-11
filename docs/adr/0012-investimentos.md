# ADR-0012 — Investimentos e proventos

Status: aceito (2026-10-30). Cotação, proventos e índices do Banco Central automáticos: ver ADR-0017. Importação da B3
e da nota de corretagem: ver ADR-0024. Importação de proventos: ver ADR-0029. Operação com conta gera lançamento, que é aporte ou resgate, nunca despesa ou receita: ver ADR-0027.

## Decisão

- **Preço médio** pela regra usual: compra soma custo e taxas; venda baixa pelo preço médio, sem mudá-lo, e apura o
  resultado. Venda maior que a posição na data entra mesmo assim (desde 2026-11-10): a compra pode estar numa
  nota que ainda não foi importada. A posição fica em zero e a carteira avisa até a compra chegar.
- **Editar operação** em Investimentos → Lançamentos: muda lado, data, quantidade, preço, taxas e conta. O
  lançamento da conta é refeito (sai o antigo, entra o novo). Nota de corretagem no importador usa a conta
  escolhida no arquivo para o dinheiro de toda a nota.
- **Duas formas de valor.** Ação, FII e ETF/BDR valem quantidade × preço. Renda fixa, fundo, previdência, exterior e
  outros valem o total informado pela família, porque o extrato já traz esse número. Sem valor informado, mostramos
  o custo e avisamos.
- **Aporte em classe sem preço unitário** é gravado com quantidade = valor e preço = 1. O resgate baixa o aplicado
  na proporção do que saiu do valor atual, para o rendimento virar resultado realizado.
- **Investimento entra no patrimônio** (`summarizeNetWorth`), e as fotos mensais do worker passam a incluí-lo.
- **Operação não mexe em conta.** Não há transferência entre contas no sistema, e lançar como despesa distorceria
  o mês. A tela avisa para ajustar o saldo e não contar duas vezes.
- **Metas por classe só comparam.** Não existe ativo sugerido nem texto de compra ou venda, conforme a regra da CVM
  anotada no plano-mestre.
- **Proventos** ficam ligados ao investimento, com bruto e imposto retido como no extrato. O sistema não calcula
  imposto. Totais e meta usam o valor líquido.

## Fora do escopo por enquanto

Cotação automática, importação da Área do Investidor da B3, desdobramento, grupamento e bonificação, índices do
Banco Central, DARF e IR de vendas.
