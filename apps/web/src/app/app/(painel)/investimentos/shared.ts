// Partes comuns das três telas de investimentos.
import { useEffect } from "react";
import { money } from "@organizeup/domain";
import type { loadPortfolio } from "@/lib/investments";
import type { FormState } from "./actions";

export type Data = Awaited<ReturnType<typeof loadPortfolio>>;
export type Row = Data["rows"][number];
export type Trade = Row["trades"][number];

export const CLASS_LABEL: Record<string, string> = {
  acao: "Ações",
  fii: "Fundos imobiliários",
  etf_bdr: "ETFs e BDRs",
  renda_fixa: "Renda fixa",
  fundo: "Fundos",
  previdencia: "Previdência",
  exterior: "Exterior",
  outro: "Outros",
};

export const initial: FormState = { ok: false, message: null };
export const fullDate = (date: string) => date.split("-").reverse().join("/");
export const quantityText = (value: string) => money(value).toNumber().toLocaleString("pt-BR");
export const percentText = (value: number) => `${value.toLocaleString("pt-BR")}%`;
export const toInput = (value: string | null) =>
  value === null ? "" : money(value).toString().replace(".", ",");

export function useCloseOnSuccess(state: FormState, onDone: () => void) {
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
}
