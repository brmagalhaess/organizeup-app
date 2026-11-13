# ADR-0040 — De quem é cada lançamento

Status: aceito (2026-11-13)

## Contexto

Com a conexão do banco (ADR-0038), os lançamentos de duas pessoas chegam sozinhos e caem na mesma lista. O
fundador pediu um marcador com o nome de quem fez cada lançamento e uma comparação de quanto cada um gastou,
em Lançamentos e no Painel. O lançamento não guarda pessoa, e quase tudo entra sem ninguém digitar.

## Decisão

- **A pessoa vem da conta, e não do lançamento.** Cada conta e cada cartão podem ter um dono
  (`accounts.person_id` e `credit_cards.person_id`, migração 0054). O lançamento herda o da conta em que caiu.
  Não há campo de pessoa no lançamento: seria mais um dado para o banco não preencher e a pessoa esquecer.
- **Conta ligada ao banco já tem dono.** Sem escolha na tela, vale a pessoa da chave que trouxe a conta
  (`bank_connections.person_id`). Isso é lido na hora, sem preencher a coluna: a migração roda sem passar
  pela RLS da família, e um `UPDATE` de dados nela não alcançaria nenhuma linha. A escolha da tela ("De quem
  é", em Contas e em Cartões) vale mais que a do banco.
- **A fatura é de quem é o cartão**, aberta ou já paga, mesmo quando sai da conta de outra pessoa. O
  pagamento é reconhecido por `card_statement_payments`. Cartão sem dono segue a conta que paga.
- **A renda prevista é de quem é a fonte de renda** (`income_sources.person_id`, que já existia); sem pessoa
  na fonte, segue a conta.
- **Sem dono, é uso comum.** A linha "Uso comum" fecha a soma: os gastos por pessoa somam o mesmo "Despesas"
  do mês, com os aportes de fora (ADR-0027), porque partem da mesma lista do resumo (`splitCardSavings`).
- **Só aparece para quem separa.** O marcador, o filtro e o quadro existem quando alguma conta ou cartão tem
  dono. Renda com pessoa, sozinha, não liga a tela: quem só cadastrou o salário veria tudo como "uso comum". O campo "De quem é" aparece com duas pessoas ou mais no cadastro.
- **Cor fixa por pessoa**, pela ordem do cadastro entre as que têm algo no nome, com as quatro cores de
  partes de um todo (`--color-part-1..4`). O nome vai sempre escrito ao lado: a cor não é o único sinal. Da
  quinta pessoa em diante o ponto fica neutro.
- **Regra em `packages/domain/src/person-spending.ts`** (`entryPerson`, `spendingByPerson`), sem banco; a
  leitura dos donos em `apps/web/src/lib/owners.ts`, tolerante a banco atrasado (ADR-0023).

## Consequências

- Conta conjunta ligada pela chave de uma pessoa aparece como dela. Para tratá-la como de uso comum não há
  opção ainda: a escolha vazia volta ao padrão do banco.
- Gasto de uma pessoa feito na conta ou no cartão de outra conta para a dona da conta. Dividir um lançamento
  entre pessoas fica fora.
- Transferência entre contas de pessoas diferentes não é gasto de ninguém: transferência não é despesa.
- Apagar a pessoa do cadastro devolve a conta e o cartão ao padrão (`ON DELETE SET NULL`).
