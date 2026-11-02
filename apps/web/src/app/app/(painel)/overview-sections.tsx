// Blocos do painel, no servidor. Quem carrega é `page.tsx`; aqui só se mostra o que veio pronto.
import { money, percentOf, type CardMonth, type FoldedCategories } from "@organizeup/domain";
import { AlertCircle, ArrowRight, Check, Clock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/styles";
import { Badge, Card } from "@/components/ui";
import { formatDayMonth, formatMonthYear, formatPercentExact, type MoneyText } from "@/i18n/format";
import type { loadOverview } from "@/lib/finance-data";
import type { loadMonthInvestments } from "@/lib/investments";
import type { AssetClass } from "./investimentos/shared";

type Overview = Awaited<ReturnType<typeof loadOverview>>;
type MonthInvestments = Awaited<ReturnType<typeof loadMonthInvestments>>;

const linkClass = "text-sm font-medium underline-offset-2 hover:underline";

/** Convite curto no lugar de um bloco vazio. */
export function ModuleInvite({
  id,
  title,
  text,
  href,
  action,
}: {
  id?: string;
  title: string;
  text: string;
  href?: string;
  action?: string;
}) {
  return (
    <section
      id={id}
      className="flex scroll-mt-20 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-2xl border border-line bg-card px-5 py-4 shadow-card"
    >
      <div className="min-w-0 flex-1 basis-56">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-sm text-muted">{text}</p>
      </div>
      {href && action ? (
        <Link href={href} className={linkClass}>
          {action}
        </Link>
      ) : null}
    </section>
  );
}

type BarTone = "receita" | "despesa" | "aporte";

const BAR_COLORS: Record<BarTone, { solid: string; light: string }> = {
  receita: { solid: "bg-income", light: "bg-income/35" },
  despesa: { solid: "bg-expense", light: "bg-expense/35" },
  aporte: { solid: "bg-brand-500", light: "bg-brand-500/35" },
};

function Legend({ tone }: { tone: BarTone }) {
  const t = useTranslations("dashboard.categories");
  const { solid, light } = BAR_COLORS[tone];
  return (
    <ul className="m-0 mb-3 flex list-none gap-4 p-0 text-xs text-muted">
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className={cx("size-2.5 rounded-sm", solid)} />
        {t("done")}
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className={cx("size-2.5 rounded-sm", light)} />
        {t("planned")}
      </li>
    </ul>
  );
}

interface BarRow {
  key: string;
  name: string;
  amount: string;
  done: string;
  planned: string;
  percent: number;
  href: string;
}

/** Barras horizontais, do maior para o menor, cada uma abrindo os lançamentos filtrados. */
export function CategoryBars({
  id,
  title,
  description,
  tone,
  rows,
  empty,
  money: moneyText,
}: {
  id?: string;
  title: string;
  description: string;
  tone: BarTone;
  rows: BarRow[];
  empty: string;
  money: MoneyText;
}) {
  const t = useTranslations("dashboard.categories");
  const locale = useLocale();
  const largest = rows.reduce((acc, row) => (money(row.amount).gt(acc) ? row.amount : acc), "0.00");
  const { solid, light } = BAR_COLORS[tone];
  const anyPlanned = rows.some((row) => !money(row.planned).isZero());
  return (
    <div id={id} className="min-w-0 scroll-mt-20">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mb-3 text-xs text-muted">{description}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <>
          {anyPlanned ? <Legend tone={tone} /> : null}
          <ul aria-label={title} className="m-0 flex list-none flex-col gap-1 p-0">
            {rows.map((row) => (
              <li key={row.key}>
                <Link
                  href={row.href}
                  prefetch={false}
                  className="block rounded-lg px-2 py-1.5 -mx-2 hover:bg-brand-50"
                >
                  <span className="flex justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">{row.name}</span>
                    <span className="whitespace-nowrap tabular-nums text-muted">
                      {moneyText(row.amount)} · {formatPercentExact(row.percent, locale, 1)}
                    </span>
                  </span>
                  <span aria-hidden="true" className="mt-1 flex h-2 gap-0.5">
                    {money(row.done).isZero() ? null : (
                      <span
                        className={cx("block rounded-l-sm last:rounded-r", solid)}
                        style={{ width: `${percentOf(row.done, largest)}%` }}
                      />
                    )}
                    {money(row.planned).isZero() ? null : (
                      <span
                        className={cx("block rounded-r first:rounded-l-sm", light)}
                        style={{ width: `${percentOf(row.planned, largest)}%` }}
                      />
                    )}
                  </span>
                  {money(row.planned).isZero() ? null : (
                    <span className="mt-0.5 block text-xs text-muted">
                      {t("plannedPart", { amount: moneyText(row.planned) })}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Linhas de barra a partir das categorias dobradas. */
export function barRows(
  folded: FoldedCategories,
  options: {
    nameOf: (id: string) => string;
    hrefOf: (id: string | null) => string;
    otherName: string;
  },
): BarRow[] {
  const rows: BarRow[] = folded.rows.map((row) => ({
    key: row.categoryId,
    name: options.nameOf(row.categoryId),
    amount: row.amount,
    done: row.done,
    planned: row.planned,
    percent: row.percent,
    href: options.hrefOf(row.categoryId),
  }));
  if (!folded.other) return rows;
  return [
    ...rows,
    {
      key: "outras",
      name: options.otherName,
      amount: folded.other.amount,
      done: folded.other.done,
      planned: folded.other.planned,
      percent: folded.other.percent,
      href: options.hrefOf(null),
    },
  ];
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <span className="min-w-0">
      <span className="block text-xs text-muted">{label}</span>
      <span className="block text-sm font-medium tabular-nums">{value}</span>
    </span>
  );
}

function CardBadge({ status }: { status: NonNullable<CardMonth["status"]> }) {
  const t = useTranslations("dashboard.accounts.status");
  if (status === "paga")
    return (
      <Badge tone="success">
        <Check className="size-3" aria-hidden="true" />
        {t("paga")}
      </Badge>
    );
  if (status === "atrasada")
    return (
      <Badge tone="danger">
        <AlertCircle className="size-3" aria-hidden="true" />
        {t("atrasada")}
      </Badge>
    );
  return (
    <Badge>
      <Clock className="size-3" aria-hidden="true" />
      {t(status)}
    </Badge>
  );
}

/** Contas e cartões do mês. A fatura paga é despesa da conta que paga: o cartão é só o detalhe. */
export function AccountsSection({
  data,
  moneyText,
  nameOf,
}: {
  data: Overview;
  moneyText: MoneyText;
  nameOf: (name: string) => string;
}) {
  const t = useTranslations("dashboard.accounts");
  const locale = useLocale();
  const { month, phase } = data.period;
  const future = phase === "futuro";
  const label = formatMonthYear(month, locale);
  const balanceLabel = future
    ? t("balanceProjected")
    : phase === "passado"
      ? t("balanceEnd")
      : t("balanceNow");
  return (
    <Card title={t("title")} description={t("description", { month: label })}>
      <ul aria-label={t("title")} className="m-0 list-none divide-y divide-line p-0">
        {data.accounts.map((account) => (
          <li key={account.id} className="py-3 first:pt-0 last:pb-0">
            <Link
              href={`/app/lancamentos?m=${month}&conta=${account.id}`}
              prefetch={false}
              className="text-sm font-medium underline-offset-2 hover:underline"
            >
              {nameOf(account.name)}
            </Link>
            {account.archived ? (
              <span className="ml-2 text-xs text-muted">{t("archived")}</span>
            ) : null}
            <span className="mt-1 grid grid-cols-3 gap-2">
              <Figure
                label={future ? t("incomePlanned") : t("income")}
                value={moneyText(future ? account.plannedIncome : account.received)}
              />
              <Figure
                label={future ? t("expensesPlanned") : t("expenses")}
                value={moneyText(future ? account.plannedExpense : account.spent)}
              />
              <Figure
                label={balanceLabel}
                value={moneyText(future ? account.projected : account.balance)}
              />
            </span>
            {money(future ? account.plannedContribution : account.contributed).isZero() ? null : (
              <span className="mt-1 block text-xs text-muted">
                {t("contributed", {
                  amount: moneyText(future ? account.plannedContribution : account.contributed),
                })}
              </span>
            )}
            {account.foreign && !future ? (
              <span className="mt-1 block text-xs text-muted">
                {t("native", {
                  amount: moneyText(account.nativeBalance, "full", account.currency),
                })}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {data.cards.length === 0 ? null : (
        <>
          <h3 className="mb-2 mt-5 text-sm font-semibold">{t("cards")}</h3>
          <ul aria-label={t("cards")} className="m-0 list-none divide-y divide-line p-0">
            {data.cards.map((card) => (
              <li key={card.id} className="py-3 first:pt-0 last:pb-0">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <Link href="/app/cartoes" className={linkClass}>
                    {card.name}
                  </Link>
                  {card.status ? <CardBadge status={card.status} /> : null}
                </span>
                <span className="mt-1 grid grid-cols-2 gap-2">
                  <Figure label={t("statement")} value={moneyText(card.statement)} />
                  <Figure label={t("ahead")} value={moneyText(card.ahead)} />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-4 text-xs text-muted">{t("note")}</p>
    </Card>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="m-0 text-base font-semibold tabular-nums tracking-tight">{value}</dd>
      {hint ? <dd className="m-0 text-xs text-muted">{hint}</dd> : null}
    </div>
  );
}

/** Investimentos: o que é do mês vem das operações; carteira e divisão são a posição de hoje. */
export function InvestmentsSection({
  data,
  month,
  moneyText,
}: {
  data: MonthInvestments;
  month: string;
  moneyText: MoneyText;
}) {
  const t = useTranslations("dashboard.investments");
  const tClass = useTranslations("investimentos");
  const locale = useLocale();
  const label = formatMonthYear(month, locale);
  const gainHint =
    data.gainPercent === null ? undefined : formatPercentExact(data.gainPercent, locale, 1);
  return (
    <Card
      title={t("title")}
      description={data.past ? t("descriptionPast", { month: label }) : t("description")}
      actions={
        <Link href="/app/investimentos" className={linkClass}>
          {t("open")}
        </Link>
      }
    >
      <h3 className="mb-2 text-xs font-semibold text-muted">{t("todayHeading")}</h3>
      <dl className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label={t("value")} value={moneyText(data.total)} />
        <Stat label={t("cost")} value={moneyText(data.cost)} />
        <Stat
          label={t("gain")}
          value={moneyText(data.gain)}
          {...(gainHint ? { hint: gainHint } : {})}
        />
      </dl>
      {data.estimated > 0 ? (
        <p className="mt-2 text-xs text-muted">{t("estimated", { count: data.estimated })}</p>
      ) : null}

      <h3 className="mb-2 mt-4 text-xs font-semibold text-muted">
        {t("monthHeading", { month: label })}
      </h3>
      <dl className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {data.future ? null : (
          <>
            <Stat label={t("bought")} value={moneyText(data.bought)} />
            <Stat label={t("sold")} value={moneyText(data.sold)} />
          </>
        )}
        {data.investedAtEnd === null ? null : (
          <Stat
            label={t("investedAtEnd")}
            value={moneyText(data.investedAtEnd)}
            hint={t("history")}
          />
        )}
      </dl>
      {data.future ? <p className="text-xs text-muted">{t("futureNote")}</p> : null}
      {data.future ? null : <p className="mt-2 text-xs text-muted">{t("cashNote")}</p>}

      {data.classes.length === 0 ? null : (
        <>
          <h3 className="mb-2 mt-4 text-xs font-semibold text-muted">{t("classes")}</h3>
          <ul aria-label={t("classes")} className="m-0 flex list-none flex-col gap-2 p-0">
            {data.classes.map((share) => (
              <li key={share.assetClass}>
                <span className="flex justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">
                    {tClass(`classes.${share.assetClass as AssetClass}`)}
                  </span>
                  <span className="whitespace-nowrap tabular-nums text-muted">
                    {moneyText(share.value)} · {formatPercentExact(share.percent, locale, 1)}
                  </span>
                </span>
                <span aria-hidden="true" className="mt-1 block h-2 rounded bg-brand-50">
                  <span
                    className="block h-full rounded bg-brand-500"
                    style={{ width: `${share.percent}%` }}
                  />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-4 text-xs text-muted">{t("note")}</p>
    </Card>
  );
}

/** Proventos: recebido, anunciado de verdade e, à parte, a estimativa pelo histórico. */
export function DividendsSection({
  data,
  month,
  moneyText,
}: {
  data: MonthInvestments;
  month: string;
  moneyText: MoneyText;
}) {
  const t = useTranslations("dashboard.dividends");
  const locale = useLocale();
  const label = formatMonthYear(month, locale);
  const { dividends, upcoming } = data;
  return (
    <Card
      title={t("title")}
      description={t("description")}
      actions={
        <Link href="/app/proventos" className={linkClass}>
          {t("open")}
        </Link>
      }
    >
      <dl className="m-0 grid grid-cols-2 gap-3">
        <Stat label={t("received", { month: label })} value={moneyText(dividends.received)} />
        <Stat label={t("last12")} value={moneyText(dividends.last12)} hint={t("last12Hint")} />
        <Stat label={t("announced")} value={moneyText(dividends.announced)} />
        <Stat label={t("ahead")} value={moneyText(dividends.ahead)} />
      </dl>
      {dividends.estimate ? (
        <p className="mt-3 text-xs text-muted">
          {t("estimate", { amount: moneyText(dividends.estimate) })}
        </p>
      ) : null}
      {upcoming.length === 0 ? null : (
        <ul
          aria-label={t("upcoming")}
          className="m-0 mt-3 list-none divide-y divide-line border-t border-line p-0"
        >
          {upcoming.map((row) => (
            <li key={row.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="w-12 shrink-0 tabular-nums text-muted">
                {formatDayMonth(row.paidOn, locale)}
              </span>
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
              <span className="whitespace-nowrap font-medium tabular-nums">
                {moneyText(row.net)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Reserva, patrimônio e o que mais é posição de hoje: dois blocos pequenos, mesmo no celular. */
export function SmallTile({
  href,
  title,
  value,
  hint,
}: {
  href: string;
  title: string;
  value?: string;
  hint?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="min-w-0 rounded-2xl border border-line bg-card p-4 shadow-card transition hover:border-brand-500 sm:p-5"
    >
      <p className="text-sm text-muted">{title}</p>
      {value ? (
        <p className="mt-1 text-lg font-semibold tracking-tight sm:text-2xl">{value}</p>
      ) : null}
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </Link>
  );
}

/** Atalhos para as seções, só no celular, onde a tela é longa. */
export function SectionLinks({ items }: { items: Array<{ href: string; label: string }> }) {
  const t = useTranslations("dashboard.picker");
  return (
    <nav aria-label={t("sections")} className="flex flex-wrap gap-x-4 gap-y-1 lg:hidden">
      {items.map((item) => (
        <a
          key={item.href}
          href={item.href}
          className={cx(linkClass, "inline-flex items-center gap-1 py-1")}
        >
          {item.label}
          <ArrowRight className="size-3 rotate-90" aria-hidden="true" />
        </a>
      ))}
    </nav>
  );
}
