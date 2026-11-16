# ADR-0042 — Transferência entre contas da casa reconhecida no extrato

Status: aceito (2026-11-15)

## Contexto

Com duas pessoas trazendo o extrato pelo banco (ADR-0038), o dinheiro que uma passa para a outra chega como
duas linhas: saída numa conta, entrada na outra. O mesmo vale para a mesma pessoa movendo dinheiro entre
duas contas dela. Cada linha virava um lançamento, e o mês somava a saída como despesa e a entrada como
receita. Na conta do fundador, mais de um terço das receitas e perto da metade das despesas de um mês eram
isso. A sobra do mês saía errada, e com ela o plano, a reserva, as metas e as viagens.

## Decisão

- **As duas linhas viram uma transferência** (`account_transfers`), a mesma de "Transferir entre contas". Os
  dois lançamentos saem. O saldo de cada conta não muda; o mês deixa de contar a saída e a entrada. Trocar os
  lançamentos pela transferência, em vez de marcá-los, corrige de uma vez todas as telas e agentes que leem
  lançamentos.
- **Quando casa** (`pairOwnTransfers`, em `packages/domain/src/own-transfers.ts`): mesmo valor, contas
  diferentes, até um dia de distância, e o extrato confirma.
  - Entre pessoas, os **dois** lados precisam citar a dona da outra conta: a saída diz para quem foi e a
    entrada diz de quem veio. O nome é o do cadastro de pessoas, comparado por primeiro nome e mais um nome.
  - Na mesma pessoa, basta um lado citar o próprio nome ou a frase do banco para conta própria ("conta
    digital", "conta investimento", "mesma titularidade").
  - O dono da conta é o do ADR-0040. Conta sem dono não casa.
- **Sem confirmação, nada casa.** Um Pix para fora e outro de mesmo valor vindo de fora no mesmo dia não são
  transferência. Deixar passar um par é melhor que juntar dois lançamentos que não têm relação.
- **O que entra na busca**: lançamento realizado que veio do banco, na moeda principal, cuja categoria ninguém
  da família escolheu. Fica de fora o que a família classificou à mão, previsão confirmada pelo extrato,
  pagamento de fatura, renda recebida e parcela de meta.
- **Vale para o que já estava lançado.** A busca olha tudo, e não só a rodada: roda no fim de cada atualização
  automática, em "Atualizar contas" e depois de uma importação pela conexão.
- **A linha não volta.** A transferência guarda a marca de importação de cada ponta (migração 0055), e a
  conferência do extrato trata essas marcas como já importadas. De quebra, a transferência lançada à mão
  deixa de se repetir quando o banco mostra as duas pontas.
- **Desfazer** (em Contas, na lista de transferências): a que veio do banco volta a ser dois lançamentos, com
  a descrição do banco, em "Outras despesas" e "Outras receitas", marcados como escolha da família. Assim não
  são juntados de novo.

## Consequências

- Transferência para conta própria que não está ligada ao banco continua como despesa: só há uma ponta.
- Entrada sem nome no extrato (alguns TEDs) não casa entre pessoas.
- Desfazer a importação de um lote não desfaz a transferência que saiu dele: desfaz-se pela lista de
  transferências.
- O relatório de importação do dia continua contando as duas linhas como lançamentos trazidos.
- A lista de transferências recentes mostra só as 20 últimas.
