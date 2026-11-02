// Partes comuns das três telas de investimentos.
import { useEffect } from "react";
import { investmentClassAllowed, money, type Currency } from "@organizeup/domain";
import { formatNumber, formatPercentExact, toInputValue } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import type { loadPortfolio } from "@/lib/investments";
import type { FormState } from "./actions";

export type Data = Awaited<ReturnType<typeof loadPortfolio>>;
export type Row = Data["rows"][number];
export type Trade = Row["trades"][number];

/** Classes na ordem das telas. O rótulo é a chave `investimentos.classes.<código>`. */
export const ASSET_CLASSES = [
  "acao",
  "fii",
  "etf_bdr",
  "renda_fixa",
  "fundo",
  "previdencia",
  "exterior",
  "outro",
] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

/** Classes que a família pode usar, na ordem das telas. */
export const classesFor = (currency: Currency) =>
  ASSET_CLASSES.filter((value) => investmentClassAllowed(value, currency));

export const initial: FormState = { ok: false, message: null };
export const quantityText = (value: string, locale: Locale) =>
  formatNumber(money(value).toNumber(), locale);
export const percentText = (value: number, locale: Locale) => formatPercentExact(value, locale);
export const toInput = (value: string | null, locale: Locale) =>
  value === null ? "" : toInputValue(value, locale);

export function useCloseOnSuccess(state: FormState, onDone: () => void) {
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
}
