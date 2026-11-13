// De quem é cada lançamento e quanto cada pessoa gastou no mês. O lançamento não guarda a pessoa: herda a da
// conta em que caiu, a fatura herda a do cartão e a renda prevista herda a da fonte de renda. Sem banco.
import { money, toDbAmount } from "./money";

export interface OwnerBook {
  /** Conta → pessoa. */
  accounts: Record<string, string>;
  /** Cartão → pessoa. */
  cards: Record<string, string>;
  /** Fonte de renda → pessoa. */
  incomes: Record<string, string>;
  /** Lançamento que pagou uma fatura → cartão dela. */
  statements: Record<string, string>;
}

interface OwnedEntry {
  /**
   * `f:<cartão>:<mês>` é fatura em aberto, `r:<renda>:<mês>:<parte>` é renda prevista e `t:<id>` é lançamento.
   * A parte de aporte separada da fatura (`splitCardSavings`) leva `#...` no fim e segue a mesma regra.
   */
  key: string;
  accountId: string;
}

/**
 * A pessoa de um lançamento, ou null quando a conta é de uso comum. A fatura é de quem é o cartão, aberta ou
 * já paga, mesmo saindo da conta de outra pessoa.
 */
export function entryPerson(entry: OwnedEntry, owners: OwnerBook): string | null {
  const [prefix, id = ""] = (entry.key.split("#")[0] ?? "").split(":");
  const cardId = prefix === "f" ? id : prefix === "t" ? owners.statements[id] : undefined;
  if (cardId && owners.cards[cardId]) return owners.cards[cardId];
  if (prefix === "r" && owners.incomes[id]) return owners.incomes[id];
  return owners.accounts[entry.accountId] ?? null;
}

export interface PersonSpendingInput {
  /** Null: conta de uso comum. */
  personId: string | null;
  /** Só despesa entra: aporte, resgate e receita ficam de fora. */
  flow: string;
  status: "previsto" | "realizado";
  amount: string;
}

export interface PersonSpending {
  personId: string | null;
  /** Despesas pagas. */
  spent: string;
  /** Despesas ainda em aberto. */
  planned: string;
  /** Fatia das despesas pagas, de 0 a 100. */
  share: number;
}

/**
 * Despesas do mês por pessoa, da que mais gastou para a que menos gastou; "uso comum" (sem pessoa) vem por
 * último. Quem não tem despesa nem prevista não aparece.
 */
export function spendingByPerson(entries: PersonSpendingInput[]): PersonSpending[] {
  const totals = new Map<
    string | null,
    { spent: ReturnType<typeof money>; planned: ReturnType<typeof money> }
  >();
  for (const entry of entries) {
    if (entry.flow !== "despesa") continue;
    const row = totals.get(entry.personId) ?? { spent: money(0), planned: money(0) };
    if (entry.status === "realizado") row.spent = row.spent.plus(entry.amount);
    else row.planned = row.planned.plus(entry.amount);
    totals.set(entry.personId, row);
  }
  const all = [...totals.values()].reduce((acc, row) => acc.plus(row.spent), money(0));
  return [...totals.entries()]
    .filter(([, row]) => row.spent.gt(0) || row.planned.gt(0))
    .sort(([aId, a], [bId, b]) => {
      if ((aId === null) !== (bId === null)) return aId === null ? 1 : -1;
      return b.spent.comparedTo(a.spent) || b.planned.comparedTo(a.planned);
    })
    .map(([personId, row]) => ({
      personId,
      spent: toDbAmount(row.spent),
      planned: toDbAmount(row.planned),
      share: all.isZero() ? 0 : row.spent.dividedBy(all).times(100).toDecimalPlaces(1).toNumber(),
    }));
}
