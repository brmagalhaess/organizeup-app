// Lançamentos do mês no app. Ler usa `loadMonth`; gravar passa pela mesma action da tela (`saveEntry`),
// para valer a mesma validação, o mesmo limite do plano e a mesma auditoria.
import { getLocale } from "next-intl/server";
import { canWrite } from "@organizeup/db";
import { money as toMoney } from "@organizeup/domain";
import { saveEntry } from "@/app/app/(painel)/lancamentos/actions";
import { formatMonthYear } from "@/i18n/format";
import { isLocale } from "@/i18n/locales";
import { getMoney } from "@/i18n/money-server";
import { loadMonth } from "@/lib/finance-data";
import { mobileEntry, mobileError, mobileJson, mobileTenant } from "@/lib/mobile-api";
import { sameSite } from "@/lib/same-site";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const tenant = await mobileTenant();
  if (tenant instanceof Response) return tenant;
  const [data, money, rawLocale] = await Promise.all([
    loadMonth(tenant.ctx, new URL(request.url).searchParams.get("m")),
    getMoney(),
    getLocale(),
  ]);
  const locale = isLocale(rawLocale) ? rawLocale : "pt-BR";
  const names = {
    categories: new Map(data.categories.map((category) => [category.id, category.name])),
    accounts: new Map(data.accounts.map((account) => [account.id, account.name])),
  };
  const { summary } = data;
  return mobileJson({
    month: data.month,
    monthLabel: formatMonthYear(data.month, locale),
    today: data.today,
    canWrite: canWrite(tenant.ctx),
    summary: {
      receivedText: money(summary.received),
      spentText: money(summary.spent),
      resultText: money(summary.balance),
      resultNegative: toMoney(summary.balance).isNegative(),
    },
    entries: [...data.entries]
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((entry) => mobileEntry(entry, money, locale, names)),
    // Para o formulário de lançamento novo.
    accounts: data.accounts
      .filter((account) => !account.archived)
      .map((account) => ({ id: account.id, name: account.name, currency: account.currency })),
    categories: data.categories
      .filter((category) => !category.archived)
      .map((category) => ({ id: category.id, name: category.name, kind: category.kind })),
  });
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** Lançamento novo. O valor chega como a pessoa digitou ("12,50"): quem interpreta é `saveEntry`. */
export async function POST(request: Request) {
  if (!sameSite(request)) return mobileError("forbidden", 403);
  const tenant = await mobileTenant();
  if (tenant instanceof Response) return tenant;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return mobileError("invalid", 400);
  const form = new FormData();
  form.set("key", "");
  for (const field of ["kind", "description", "amount", "date", "categoryId", "accountId"]) {
    form.set(field, text(body[field]));
  }
  if (body.done !== false) form.set("done", "on");
  form.set("installments", "1");
  const result = await saveEntry({ ok: false, message: null }, form);
  if (result.ok) return mobileJson({ ok: true }, 201);
  return mobileJson(
    { error: "invalid", message: result.message, fieldErrors: result.fieldErrors ?? {} },
    422,
  );
}
