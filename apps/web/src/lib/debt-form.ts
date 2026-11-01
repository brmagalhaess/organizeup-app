// Formulário de dívida: o cadastro manual e a conferência de arquivo validam com as mesmas regras.
import { z } from "zod";
import { DEBT_SYSTEMS } from "@organizeup/db";
import { parseMoney, toDbAmount, type DebtTerms } from "@organizeup/domain";
import ptBR from "../../messages/pt-BR.json";

type DebtErrors = typeof ptBR.dividas.errors;

const positiveAmount = (message: string, locale: string) =>
  z.string().transform((value, ctx) => {
    try {
      const parsed = parseMoney(value, locale);
      if (parsed.lte(0) || parsed.gte("1000000000000")) throw new RangeError("fora do limite");
      return toDbAmount(parsed);
    } catch {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
  });

const debtSchema = (locale: string, errors: DebtErrors) =>
  z
    .object({
      system: z.enum(DEBT_SYSTEMS, { message: errors.system }),
      balance: z.string(),
      installmentAmount: z.string(),
      monthlyRate: z.string().transform((value, ctx) => {
        try {
          const parsed = parseMoney(value.trim() || "0", locale);
          if (parsed.lt(0) || parsed.gt(100)) throw new RangeError("fora do limite");
          return parsed.toFixed(4);
        } catch {
          ctx.addIssue({ code: "custom", message: errors.rate });
          return z.NEVER;
        }
      }),
      installments: z.coerce
        .number({ message: errors.installments })
        .int(errors.installments)
        .min(1, errors.installments)
        .max(480, errors.installmentsMax),
      firstDueDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, errors.nextDue)
        .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), errors.invalidDate),
    })
    .superRefine((data, ctx) => {
      const field = data.system === "manual" ? "installmentAmount" : "balance";
      const message = data.system === "manual" ? errors.installmentAmount : errors.balance;
      const parsed = positiveAmount(message, locale).safeParse(data[field]);
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
export function parseDebtTerms(
  form: FormData,
  locale = "pt-BR",
  errors: DebtErrors = ptBR.dividas.errors,
): ParsedTerms {
  const parsed = debtSchema(locale, errors).safeParse({
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
      balance: manual ? "0" : toDbAmount(parseMoney(data.balance, locale)),
      monthlyRate: data.monthlyRate,
      installments: data.installments,
      firstDueDate: data.firstDueDate,
      ...(manual
        ? { installmentAmount: toDbAmount(parseMoney(data.installmentAmount, locale)) }
        : {}),
    },
  };
}
