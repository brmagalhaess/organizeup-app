"use client";
// Moeda principal da família no navegador (ADR-0020, Fase 6). Vem do layout raiz, e `useMoney` é como toda
// tela da família formata dinheiro. No servidor, `getMoney`, de `money-server.ts`.
import { brazilRulesApply, type Currency } from "@organizeup/domain";
import { useLocale } from "next-intl";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { moneyTextFor, type MoneyText } from "./format";

const FamilyCurrency = createContext<Currency>("BRL");

export function FamilyCurrencyProvider({
  currency,
  children,
}: {
  currency: Currency;
  children: ReactNode;
}) {
  return <FamilyCurrency.Provider value={currency}>{children}</FamilyCurrency.Provider>;
}

export const useFamilyCurrency = () => useContext(FamilyCurrency);

/** Formata no idioma da pessoa e, sem outra moeda pedida, na moeda principal da família. */
export function useMoney(): MoneyText {
  const locale = useLocale();
  const currency = useFamilyCurrency();
  return useMemo(() => moneyTextFor(locale, currency), [locale, currency]);
}

/** As regras brasileiras valem para esta família? */
export const useBrazilRules = () => brazilRulesApply(useFamilyCurrency());
