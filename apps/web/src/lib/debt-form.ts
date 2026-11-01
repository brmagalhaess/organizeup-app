// Formulário de dívida: o cadastro manual e a conferência de arquivo validam com as mesmas regras.
import { z } from "zod";
import { DEBT_SYSTEMS } from "@organizeup/db";
import { parseBRL, toDbAmount, type DebtTerms } from "@organizeup/domain";

const positiveAmount = (message: string) =>
  z.string().transform((value, ctx) => {
    try {
      const parsed = parseBRL(value);
      if (parsed.lte(0) || parsed.gte("1000000000000")) throw new RangeError("fora do limite");
      return toDbAmount(parsed);
    } catch {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
  });

const debtSchema = z
  .object({
    system: z.enum(DEBT_SYSTEMS, { message: "Escolha como são as parcelas." }),
    balance: z.string(),
    installmentAmount: z.string(),
    monthlyRate: z.string().transform((value, ctx) => {
      try {
        const parsed = parseBRL(value.trim() || "0");
        if (parsed.lt(0) || parsed.gt(100)) throw new RangeError("fora do limite");
        return parsed.toFixed(4);
      } catch {
        ctx.addIssue({ code: "custom", message: "Informe os juros como 2,15." });
        return z.NEVER;
      }
    }),
    installments: z.coerce
      .number({ message: "Informe quantas parcelas faltam." })
      .int("Informe quantas parcelas faltam.")
      .min(1, "Informe quantas parcelas faltam.")
      .max(480, "O limite é de 480 parcelas."),
    firstDueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe o próximo vencimento.")
      .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Data inválida."),
  })
  .superRefine((data, ctx) => {
    const field = data.system === "manual" ? "installmentAmount" : "balance";
    const message =
      data.system === "manual"
        ? "Informe o valor da parcela, como 450,00."
        : "Informe o saldo devedor, como 12.500,00.";
    const parsed = positiveAmount(message).safeParse(data[field]);
    if (!parsed.success) ctx.addIssue({ code: "custom", path: [field], message });
  });

export function fieldErrors(error: z.ZodError) {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[String(issue.path[0])] ??= issue.message;
  return out;
}

export type ParsedTerms =
  { ok: true; terms: DebtTerms } | { ok: false; fieldErrors: Record<string, string> };

/** Lê os campos de valores da dívida. O número só vale depois de passar por aqui. */
export function parseDebtTerms(form: FormData): ParsedTerms {
  const parsed = debtSchema.safeParse({
    system: form.get("system"),
    balance: form.get("balance") ?? "",
    installmentAmount: form.get("installmentAmount") ?? "",
    monthlyRate: form.get("monthlyRate") ?? "",
    installments: form.get("installments"),
    firstDueDate: form.get("firstDueDate") ?? "",
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const data = parsed.data;
  const manual = data.system === "manual";
  return {
    ok: true,
    terms: {
      system: data.system,
      balance: manual ? "0" : toDbAmount(parseBRL(data.balance)),
      monthlyRate: data.monthlyRate,
      installments: data.installments,
      firstDueDate: data.firstDueDate,
      ...(manual ? { installmentAmount: toDbAmount(parseBRL(data.installmentAmount)) } : {}),
    },
  };
}
