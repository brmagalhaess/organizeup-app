// De quem é cada conta e cada cartão, e o que isso diz dos lançamentos do mês. A conta ligada a um banco é da
// pessoa da chave (`bank_connections.person_id`); a escolha feita na tela (`person_id` da conta ou do cartão,
// migração 0054) vale mais. Sem dono, a conta é de uso comum.
import "server-only";
import {
  accountOwners,
  asc,
  bankConnectionAccounts,
  bankConnections,
  cardOwners,
  cardStatementPayments,
  eq,
  incomeSources,
  isSchemaLag,
  people,
  withHousehold,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";
import {
  entryFlow,
  entryPerson,
  spendingByPerson,
  type MonthEntry,
  type OwnerBook,
  type PersonSpending,
  type SavingsRule,
} from "@organizeup/domain";

/** A web nova pode rodar antes da migração: sem a tabela ou a coluna, a leitura volta vazia. */
async function lagging<T>(tx: TenantTx, read: (step: TenantTx) => Promise<T[]>): Promise<T[]> {
  return tx
    .transaction((step) => read(step as TenantTx))
    .catch((error: unknown) => {
      if (isSchemaLag(error)) return [];
      throw error;
    });
}

export interface PersonView {
  id: string;
  name: string;
  /** Posição fixa da pessoa entre as que têm conta, cartão ou renda: é a cor dela em todas as telas. */
  slot: number;
}

export interface Owners {
  people: Array<{ id: string; name: string }>;
  /**
   * Quem tem alguma conta, cartão ou renda no nome. Vazio: nenhuma conta nem cartão tem dono, e a casa não
   * separa por pessoa.
   */
  list: PersonView[];
  book: OwnerBook;
  /** O que foi escolhido na tela, sem o que vem do banco: é o que o formulário mostra. */
  chosen: { accounts: Record<string, string>; cards: Record<string, string> };
  /** O que vem da chave do banco, para o formulário dizer de quem a conta é sem escolha. */
  bank: { accounts: Record<string, string>; cards: Record<string, string> };
}

export async function loadOwners(tx: TenantTx): Promise<Owners> {
  const peopleRows = await tx
    .select({ id: people.id, name: people.name })
    .from(people)
    .orderBy(asc(people.createdAt));
  const known = new Set(peopleRows.map((person) => person.id));
  const pairs = (rows: Array<{ id: string | null; personId: string | null }>) =>
    Object.fromEntries(
      rows.flatMap((row) =>
        row.id && row.personId && known.has(row.personId) ? [[row.id, row.personId]] : [],
      ),
    ) as Record<string, string>;

  const links = await lagging(tx, (step) =>
    step
      .select({
        accountId: bankConnectionAccounts.accountId,
        cardId: bankConnectionAccounts.cardId,
        personId: bankConnections.personId,
      })
      .from(bankConnectionAccounts)
      .innerJoin(bankConnections, eq(bankConnections.id, bankConnectionAccounts.connectionId)),
  );
  const bank = {
    accounts: pairs(links.map((link) => ({ id: link.accountId, personId: link.personId }))),
    cards: pairs(links.map((link) => ({ id: link.cardId, personId: link.personId }))),
  };
  const chosen = {
    accounts: pairs(
      await lagging(tx, (step) =>
        step.select({ id: accountOwners.id, personId: accountOwners.personId }).from(accountOwners),
      ),
    ),
    cards: pairs(
      await lagging(tx, (step) =>
        step.select({ id: cardOwners.id, personId: cardOwners.personId }).from(cardOwners),
      ),
    ),
  };
  const incomes = pairs(
    await tx.select({ id: incomeSources.id, personId: incomeSources.personId }).from(incomeSources),
  );
  const payments = await tx
    .select({ id: cardStatementPayments.transactionId, cardId: cardStatementPayments.cardId })
    .from(cardStatementPayments);

  const book: OwnerBook = {
    accounts: { ...bank.accounts, ...chosen.accounts },
    cards: { ...bank.cards, ...chosen.cards },
    incomes,
    statements: Object.fromEntries(payments.map((row) => [row.id, row.cardId])),
  };
  // A casa só separa por pessoa quando alguma conta ou cartão tem dono: a renda com pessoa, sozinha, não liga
  // a tela, senão quem só cadastrou o salário veria tudo como "uso comum".
  const separated = Object.keys(book.accounts).length + Object.keys(book.cards).length > 0;
  const owning = new Set([
    ...Object.values(book.accounts),
    ...Object.values(book.cards),
    ...Object.values(book.incomes),
  ]);
  const list = separated
    ? peopleRows
        .filter((person) => owning.has(person.id))
        .map((person, index) => ({ ...person, slot: index + 1 }))
    : [];
  return { people: peopleRows, list, chosen, bank, book };
}

/** Para os formulários de conta e de cartão. */
export async function loadOwnerChoices(ctx: TenantContext) {
  return withHousehold(ctx, async (tx) => {
    const { people: all, list, chosen, bank } = await loadOwners(tx);
    return { people: all, list, chosen, bank };
  });
}

/** Grava a escolha da tela. Null volta ao padrão: a pessoa da chave do banco, ou uso comum. */
export async function saveOwner(
  tx: TenantTx,
  target: "account" | "card",
  id: string,
  personId: string | null,
): Promise<void> {
  if (personId) {
    const [person] = await tx.select({ id: people.id }).from(people).where(eq(people.id, personId));
    if (!person) return;
  }
  const table = target === "account" ? accountOwners : cardOwners;
  await tx
    .transaction((step) => step.update(table).set({ personId }).where(eq(table.id, id)))
    .catch((error: unknown) => {
      if (!isSchemaLag(error)) throw error;
    });
}

export interface PeopleOfMonth {
  list: PersonView[];
  /** Pessoa de cada entrada da lista, pela chave. Sem chave: uso comum. */
  of: Record<string, string>;
  /** Despesas do mês por pessoa; a linha sem pessoa é o uso comum. */
  spending: PersonSpending[];
}

/**
 * `entries` é a lista da tela; `flows` é a mesma lista com os aportes do cartão separados (`splitCardSavings`),
 * a que o resumo do mês soma. Assim os gastos por pessoa fecham com "Gastos" do mês.
 */
export function peopleOfMonth(
  owners: Owners,
  entries: MonthEntry[],
  flows: MonthEntry[],
  rule: SavingsRule,
): PeopleOfMonth {
  const { list } = owners;
  if (list.length === 0) return { list, of: {}, spending: [] };
  return {
    list,
    of: Object.fromEntries(
      entries.flatMap((entry) => {
        const personId = entryPerson(entry, owners.book);
        return personId ? [[entry.key, personId]] : [];
      }),
    ),
    spending: spendingByPerson(
      flows.map((entry) => ({
        personId: entryPerson(entry, owners.book),
        flow: entryFlow(entry, rule),
        status: entry.status,
        amount: entry.amount,
      })),
    ),
  };
}
