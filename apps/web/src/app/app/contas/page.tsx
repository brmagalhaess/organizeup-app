import type { Metadata } from "next";
import {
  accounts,
  asc,
  canWrite,
  categories,
  ensureFinanceDefaults,
  eq,
  sql,
  transactions,
  withHousehold,
} from "@organizeup/db";
import { formatBRL, money } from "@organizeup/domain";
import { Card } from "@/components/ui";
import { requireTenant } from "@/lib/session";
import { AccountForm, CategoryForm } from "./forms";

export const metadata: Metadata = { title: "Contas e categorias" };

const ACCOUNT_LABEL: Record<string, string> = {
  corrente: "Conta corrente",
  poupanca: "Poupança",
  dinheiro: "Dinheiro em espécie",
  investimento: "Investimento",
};

export default async function AccountsPage() {
  const { ctx } = await requireTenant();
  const writable = canWrite(ctx);
  const data = await withHousehold(ctx, async (tx) => {
    if (writable) await ensureFinanceDefaults(tx, ctx.householdId);
    const accountRows = await tx
      .select()
      .from(accounts)
      .where(eq(accounts.archived, false))
      .orderBy(asc(accounts.createdAt));
    const categoryRows = await tx
      .select()
      .from(categories)
      .where(eq(categories.archived, false))
      .orderBy(asc(categories.kind), asc(categories.position), asc(categories.name));
    const movements = await tx
      .select({
        accountId: transactions.accountId,
        net: sql<string>`coalesce(sum(case when ${transactions.kind} = 'receita' then ${transactions.amount} else -${transactions.amount} end), 0)`,
      })
      .from(transactions)
      .where(eq(transactions.status, "realizado"))
      .groupBy(transactions.accountId);
    return { accountRows, categoryRows, movements };
  });
  const netByAccount = new Map(data.movements.map((m) => [m.accountId, m.net]));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Contas e categorias</h1>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Contas">
          <ul aria-label="Contas" className="m-0 list-none divide-y divide-line p-0">
            {data.accountRows.map((account) => (
              <li key={account.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">{account.name}</p>
                  <p className="text-xs text-muted">{ACCOUNT_LABEL[account.type]}</p>
                </div>
                <p className="text-sm font-semibold tabular-nums">
                  {formatBRL(
                    money(account.openingBalance).plus(netByAccount.get(account.id) ?? "0"),
                  )}
                </p>
              </li>
            ))}
          </ul>
          {writable ? (
            <div className="mt-5 border-t border-line pt-5">
              <AccountForm />
            </div>
          ) : null}
        </Card>

        <Card title="Categorias">
          <ul aria-label="Categorias" className="m-0 flex list-none flex-wrap gap-2 p-0">
            {data.categoryRows.map((category) => (
              <li
                key={category.id}
                className="rounded-full border border-line px-3 py-1 text-sm"
                title={category.kind === "receita" ? "Receita" : "Despesa"}
              >
                {category.name}
              </li>
            ))}
          </ul>
          {writable ? (
            <div className="mt-5 border-t border-line pt-5">
              <CategoryForm />
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
