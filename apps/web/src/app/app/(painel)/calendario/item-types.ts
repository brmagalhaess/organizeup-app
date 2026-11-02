// Ícone e cor de cada tipo de item. A cor nunca vem sozinha: junto dela há ícone e rótulo (ADR-0008).
import type { CalendarItemType } from "@organizeup/agents";
import {
  CalendarDays,
  CreditCard,
  HandCoins,
  Landmark,
  PiggyBank,
  Plane,
  Receipt,
  Target,
  type LucideIcon,
} from "lucide-react";

export const TYPE_ICON: Record<CalendarItemType, LucideIcon> = {
  conta: Receipt,
  receita: HandCoins,
  cartao: CreditCard,
  divida: Landmark,
  meta: Target,
  aporte: PiggyBank,
  viagem: Plane,
  evento: CalendarDays,
};

/** Receita azul e despesa vermelha, como no resto do sistema. */
export const TYPE_TEXT: Record<CalendarItemType, string> = {
  conta: "text-expense",
  receita: "text-income",
  cartao: "text-expense",
  divida: "text-expense",
  meta: "text-brand-500",
  aporte: "text-brand-500",
  viagem: "text-series-b",
  evento: "text-muted",
};

export const TYPE_DOT: Record<CalendarItemType, string> = {
  conta: "bg-expense",
  receita: "bg-income",
  cartao: "bg-expense",
  divida: "bg-expense",
  meta: "bg-brand-500",
  aporte: "bg-brand-500",
  viagem: "bg-series-b",
  evento: "bg-muted",
};
