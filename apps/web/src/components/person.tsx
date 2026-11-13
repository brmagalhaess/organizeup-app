// A pessoa de uma conta, de um cartão ou de um lançamento: o marcador com o nome dela, o campo "De quem é" e
// o quadro de gastos por pessoa. A cor é a posição fixa da pessoa (`slot`), a mesma em todas as telas.
import Link from "next/link";
import { money, toDbAmount, type PersonSpending } from "@organizeup/domain";
import { cx } from "@/components/styles";

/** Posição 0 é o uso comum, sem cor; da quinta pessoa em diante a cor também acaba, e o nome segue. */
const SLOT_COLOR = ["bg-muted", "bg-part-1", "bg-part-2", "bg-part-3", "bg-part-4"] as const;
const slotColor = (slot: number) => SLOT_COLOR[slot] ?? SLOT_COLOR[0];

export interface PersonView {
  id: string;
  name: string;
  slot: number;
}

/** O nome com a cor da pessoa, sem moldura: para linhas apertadas. */
export function PersonDot({ name, slot }: { name: string; slot: number }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span aria-hidden="true" className={cx("size-2 shrink-0 rounded-full", slotColor(slot))} />
      <span className="truncate">{name}</span>
    </span>
  );
}

export function PersonTag({ name, slot, title }: { name: string; slot: number; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-card-soft px-2 py-0.5 text-xs font-medium text-ink"
    >
      <span aria-hidden="true" className={cx("size-2 shrink-0 rounded-full", slotColor(slot))} />
      <span className="truncate">{name}</span>
    </span>
  );
}

export interface PersonSpendingTexts {
  /** Nome da linha sem pessoa. */
  shared: string;
  sharedHint: string;
  /** Uma frase com quem gastou mais, ou null quando não há duas pessoas para comparar. */
  lead: string | null;
  empty: string;
  listLabel: string;
  share: (percent: number) => string;
  open: (amount: string) => string;
  see: (name: string) => string;
}

/**
 * Barras por pessoa, da que mais gastou para a que menos gastou: a parte cheia é o que já saiu, e a clara, o
 * que ainda está em aberto. O valor vem escrito ao lado; a barra é só o desenho dele.
 */
export function PersonSpendingBars({
  rows,
  people,
  moneyText,
  hrefOf,
  texts,
}: {
  rows: PersonSpending[];
  people: PersonView[];
  moneyText: (amount: string) => string;
  /** Para onde vai o nome de cada linha; null (uso comum) também tem endereço. */
  hrefOf: (personId: string | null) => string;
  texts: PersonSpendingTexts;
}) {
  if (rows.length === 0) return <p className="m-0 text-sm text-muted">{texts.empty}</p>;
  const byId = new Map(people.map((person) => [person.id, person]));
  const top = rows.reduce((max, row) => {
    const total = money(row.spent).plus(row.planned);
    return total.gt(max) ? total : max;
  }, money(0));
  const width = (amount: string) =>
    top.isZero() ? 0 : money(amount).dividedBy(top).times(100).toDecimalPlaces(2).toNumber();
  return (
    <div className="flex flex-col gap-4">
      {texts.lead ? <p className="m-0 text-sm font-medium">{texts.lead}</p> : null}
      <ul aria-label={texts.listLabel} className="m-0 flex list-none flex-col gap-4 p-0">
        {rows.map((row) => {
          const person = row.personId ? byId.get(row.personId) : undefined;
          const name = person?.name ?? texts.shared;
          const slot = person?.slot ?? 0;
          return (
            <li key={row.personId ?? "comum"} className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <Link
                  href={hrefOf(row.personId)}
                  aria-label={texts.see(name)}
                  className="flex min-w-0 items-center gap-2 text-sm font-medium underline-offset-2 hover:underline"
                >
                  <span
                    aria-hidden="true"
                    className={cx("size-2.5 shrink-0 rounded-full", slotColor(slot))}
                  />
                  <span className="truncate">{name}</span>
                </Link>
                <p className="m-0 whitespace-nowrap text-sm tabular-nums">
                  <span className="font-semibold">{moneyText(row.spent)}</span>
                  <span className="ml-2 text-xs text-muted">{texts.share(row.share)}</span>
                </p>
              </div>
              <div
                aria-hidden="true"
                className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-brand-100"
              >
                <div
                  className={cx("h-full", slotColor(slot))}
                  style={{ width: `${width(row.spent)}%` }}
                />
                <div
                  className={cx("h-full opacity-35", slotColor(slot))}
                  style={{ width: `${width(row.planned)}%` }}
                />
              </div>
              {row.planned !== "0.00" || !person ? (
                <p className="m-0 mt-1 text-xs text-muted">
                  {[
                    row.planned !== "0.00" ? texts.open(moneyText(row.planned)) : null,
                    person ? null : texts.sharedHint,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Os textos do quadro, com a frase de quem gastou mais entre as pessoas com nome. `t` é o grupo `porPessoa`. */
export function spendingTexts(
  t: (key: string, values?: Record<string, string | number>) => string,
  moneyText: (amount: string) => string,
  locale: string,
  rows: PersonSpending[],
  people: PersonView[],
): PersonSpendingTexts {
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
  const [first, second] = rows.filter((row) => row.personId !== null);
  const nameOf = (id: string | null) => people.find((person) => person.id === id)?.name ?? "";
  const names = {
    first: nameOf(first?.personId ?? null),
    second: nameOf(second?.personId ?? null),
  };
  const lead =
    !first || !second || money(first.spent).isZero()
      ? null
      : first.spent === second.spent
        ? t("tie", names)
        : t("lead", {
            ...names,
            amount: moneyText(toDbAmount(money(first.spent).minus(second.spent))),
          });
  return {
    shared: t("shared"),
    sharedHint: t("sharedHint"),
    lead,
    empty: t("empty"),
    listLabel: t("title"),
    share: (value) => t("share", { percent: percent.format(value / 100) }),
    open: (amount) => t("open", { amount }),
    see: (name) => t("see", { name }),
  };
}
