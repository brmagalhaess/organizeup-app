import { getLocale, getTranslations } from "next-intl/server";
import { formatAmount } from "@/i18n/format";

// Prévia ilustrativa do resumo do mês. Sempre exibida com o aviso de valores fictícios.
const ROWS = [
  { id: "salary", day: 5, value: "7200", positive: true },
  { id: "mortgage", day: 10, value: "1640", positive: false },
  { id: "groceries", day: 12, value: "980", positive: false },
  { id: "tripFund", day: 15, value: "450", positive: false },
] as const;

const TOTALS = [
  ["received", "7200"],
  ["spent", "4930"],
  ["left", "2270"],
] as const;

const months = [46, 58, 52, 64, 70, 66, 78, 84];

export async function ProductPreview() {
  const [t, locale] = await Promise.all([getTranslations("landing.preview"), getLocale()]);
  return (
    <figure className="m-0">
      <div className="overflow-hidden rounded-3xl border border-sand-200 bg-white shadow-[0_30px_80px_-30px_rgba(21,35,29,0.45)]">
        <div className="flex items-center justify-between border-b border-sand-100 px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone">
              {t("family")}
            </p>
            <p className="font-display text-xl text-night">{t("month")}</p>
          </div>
          <span className="rounded-full bg-sand-100 px-3 py-1 text-xs font-semibold text-pine">
            {t("onPlan")}
          </span>
        </div>

        <div className="grid gap-px bg-sand-100 sm:grid-cols-3">
          {TOTALS.map(([label, value]) => (
            <div key={label} className="bg-white px-6 py-4">
              <p className="text-xs text-stone">{t(label)}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-night">
                {formatAmount(value, locale)}
              </p>
            </div>
          ))}
        </div>

        <div className="grid gap-6 p-6 md:grid-cols-[1fr_13rem]">
          <ul className="m-0 list-none divide-y divide-sand-100 p-0">
            {ROWS.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium text-night">{t(row.id)}</p>
                  <p className="text-xs text-stone">{t("day", { day: row.day })}</p>
                </div>
                <p
                  className={`text-sm font-semibold tabular-nums ${
                    row.positive ? "text-pine" : "text-clay"
                  }`}
                >
                  {row.positive ? "+" : "−"} {formatAmount(row.value, locale)}
                </p>
              </li>
            ))}
          </ul>

          <div aria-hidden="true" className="flex flex-col justify-end rounded-2xl bg-sand-50 p-4">
            <p className="mb-3 text-xs font-semibold text-stone">{t("wealth")}</p>
            <div className="flex h-32 items-end gap-1.5">
              {months.map((height, index) => (
                <span
                  key={index}
                  className="flex-1 rounded-t bg-pine/80 last:bg-clay"
                  style={{ height: `${height}%` }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-center text-xs text-stone">{t("caption")}</figcaption>
    </figure>
  );
}
