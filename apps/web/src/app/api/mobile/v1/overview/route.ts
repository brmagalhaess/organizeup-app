// Tela inicial do app: os mesmos números do painel (`loadOverview`), já escritos para mostrar.
import { getLocale } from "next-intl/server";
import { money as toMoney } from "@organizeup/domain";
import { formatMonthYear } from "@/i18n/format";
import { isLocale } from "@/i18n/locales";
import { getMoney } from "@/i18n/money-server";
import { loadOverview } from "@/lib/finance-data";
import { mobileEntry, mobileJson, mobileTenant } from "@/lib/mobile-api";
import { countUnread } from "@/lib/notifications";

export const dynamic = "force-dynamic";

/** Quantos lançamentos a tela inicial mostra; a lista inteira fica na aba de lançamentos. */
const RECENT = 8;

export async function GET(request: Request) {
  const tenant = await mobileTenant();
  if (tenant instanceof Response) return tenant;
  const month = new URL(request.url).searchParams.get("m");
  const [data, unread, money, rawLocale] = await Promise.all([
    loadOverview(tenant.ctx, month),
    countUnread(tenant.ctx),
    getMoney(),
    getLocale(),
  ]);
  const locale = isLocale(rawLocale) ? rawLocale : "pt-BR";
  const names = {
    categories: data.categoryNames,
    accounts: new Map(data.accounts.map((account) => [account.id, account.name])),
  };
  const { summary, period } = data;
  return mobileJson({
    month: period.month,
    monthLabel: formatMonthYear(period.month, locale),
    previous: period.previous,
    next: period.next,
    phase: period.phase,
    fresh: data.fresh,
    unread,
    balance: {
      text: money(data.balance.value),
      negative: toMoney(data.balance.value).isNegative(),
      projectedText: money(data.balance.projected),
    },
    summary: {
      receivedText: money(summary.received),
      spentText: money(summary.spent),
      resultText: money(summary.balance),
      resultNegative: toMoney(summary.balance).isNegative(),
      contributedText: money(summary.contributed),
      plannedIncomeText: money(summary.plannedIncome),
      plannedExpenseText: money(summary.plannedExpense),
    },
    pending: data.pending.map((entry) => mobileEntry(entry, money, locale, names)),
    recent: data.entries
      .filter((entry) => entry.status === "realizado")
      .slice(0, RECENT)
      .map((entry) => mobileEntry(entry, money, locale, names)),
    accounts: data.accounts
      .filter((account) => !account.archived)
      .map((account) => ({
        id: account.id,
        name: account.name,
        type: account.type,
        balanceText: money(account.nativeBalance, undefined, account.currency),
        negative: toMoney(account.nativeBalance).isNegative(),
      })),
    cards: data.cards.map((card) => ({
      id: card.id,
      name: card.name,
      statementText: money(card.statement),
      status: card.status,
      aheadText: money(card.ahead),
    })),
  });
}
