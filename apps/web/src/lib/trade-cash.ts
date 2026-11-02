import "server-only";
import {
  accountCurrencyFrozen,
  accounts,
  ensureCategory,
  eq,
  mainEntry,
  TRADE_SIDES,
  transactions,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";
import { CONTRIBUTION_CATEGORY, money, toDbAmount, type TradeInput } from "@organizeup/domain";

/** Conta estrangeira sem cotação na data da operação: nada é gravado. */
export class MissingQuote extends Error {}

/** Lançamento da operação na conta. A categoria de aportes fica fora do que sobra no mês. */
export async function recordTradeCash(
  tx: TenantTx,
  ctx: TenantContext,
  input: {
    accountId: string;
    side: (typeof TRADE_SIDES)[number];
    name: string;
    trade: TradeInput;
  },
): Promise<string | null> {
  const { accountId, side, name, trade } = input;
  const gross = money(trade.quantity).times(trade.unitPrice);
  const total = side === "compra" ? gross.plus(trade.fees) : gross.minus(trade.fees);
  if (total.lte(0)) return null;
  const [account] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, accountId));
  // Moeda adicional cancelada: a conta fica só leitura (ADR-0023).
  if (!account || (await accountCurrencyFrozen(tx, accountId))) throw new RangeError("conta");
  // A carteira é na moeda principal; numa conta estrangeira, o lançamento converte pela data da operação.
  const entry = await mainEntry(tx, accountId, toDbAmount(total), trade.occurredOn);
  if (!entry) throw new MissingQuote();
  const kind = side === "compra" ? "despesa" : "receita";
  const category = await ensureCategory(tx, ctx.householdId, kind, CONTRIBUTION_CATEGORY, false);
  const [row] = await tx
    .insert(transactions)
    .values({
      householdId: ctx.householdId,
      accountId,
      categoryId: category.id,
      kind,
      description: `${side === "compra" ? "Aporte em" : "Resgate de"} ${name}`.slice(0, 200),
      ...entry,
      occurredOn: trade.occurredOn,
      categorySource: "familia",
      createdBy: ctx.userId,
    })
    .returning({ id: transactions.id });
  return row!.id;
}
