"use server";
import type { Messages } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  confirmDebtDocument,
  createDebtWithSchedule,
  deleteDebtDocument,
} from "@organizeup/agents";
import { acceptDebtFiles, canUseAssistant } from "@organizeup/ai";
import { accounts, canWrite, debtInstallments, debts, eq, withHousehold } from "@organizeup/db";
import { knownText } from "@/i18n/known-text";
import { audit } from "@/lib/audit";
import { fieldErrors, parseDebtTerms } from "@/lib/debt-form";
import { LEGAL_VERSION } from "@/lib/legal";
import { requireTenant } from "@/lib/session";
import ptBR from "../../../../../messages/pt-BR.json";

export interface DebtFormState {
  ok: boolean;
  message: string | null;
  fieldErrors?: Record<string, string>;
}

const readOnly = async () => (await getTranslations("settings"))("noPermission");

const commonSchema = (errors: Messages["dividas"]["errors"]) =>
  z.object({
    id: z.string(),
    name: z.string().trim().min(1, errors.name).max(80),
    accountId: z.string().min(1, errors.account),
  });

/** Cria a dívida com seu calendário. Na edição, só nome e conta mudam. */
export async function saveDebt(_prev: DebtFormState, form: FormData): Promise<DebtFormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return { ok: false, message: await readOnly() };
  const [t, locale, { dividas }] = await Promise.all([
    getTranslations("dividas"),
    getLocale(),
    getMessages(),
  ]);

  const common = commonSchema(dividas.errors).safeParse({
    id: form.get("id") ?? "",
    name: form.get("name") ?? "",
    accountId: form.get("accountId") ?? "",
  });
  if (!common.success) return { ok: false, message: null, fieldErrors: fieldErrors(common.error) };
  const { id, name, accountId } = common.data;

  if (id) {
    const failure = await withHousehold(ctx, async (tx) => {
      const [account] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.id, accountId));
      if (!account) return t("errors.invalidAccount");
      await tx.update(debts).set({ name, accountId }).where(eq(debts.id, id));
      await audit(tx, ctx, "update", "debts", id);
      return null;
    });
    if (failure) return { ok: false, message: failure };
    revalidatePath("/app", "layout");
    return { ok: true, message: t("saved") };
  }

  const parsed = parseDebtTerms(form, locale, dividas.errors);
  if (!parsed.ok) return { ok: false, message: null, fieldErrors: parsed.fieldErrors };

  const failure = await withHousehold(ctx, async (tx) => {
    const [account] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    if (!account) return t("errors.invalidAccount");
    await createDebtWithSchedule(tx, ctx, { name, accountId, terms: parsed.terms });
    return null;
  });
  if (failure) return { ok: false, message: failure };
  revalidatePath("/app", "layout");
  return { ok: true, message: t("created") };
}

/** Sem parcela paga, apaga. Com histórico, encerra: as parcelas em aberto saem do mês. */
export async function closeDebt(form: FormData): Promise<void> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return;
  const id = String(form.get("id") ?? "");
  await withHousehold(ctx, async (tx) => {
    const rows = await tx
      .select({ transactionId: debtInstallments.transactionId })
      .from(debtInstallments)
      .where(eq(debtInstallments.debtId, id));
    if (rows.some((row) => row.transactionId !== null)) {
      await tx.update(debts).set({ archived: true }).where(eq(debts.id, id));
      await audit(tx, ctx, "archive", "debts", id);
    } else {
      await tx.delete(debts).where(eq(debts.id, id));
      await audit(tx, ctx, "delete", "debts", id);
    }
  });
  revalidatePath("/app", "layout");
}

export async function reopenDebt(form: FormData): Promise<void> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return;
  const id = String(form.get("id") ?? "");
  await withHousehold(ctx, async (tx) => {
    await tx.update(debts).set({ archived: false }).where(eq(debts.id, id));
    await audit(tx, ctx, "restore", "debts", id);
  });
  revalidatePath("/app", "layout");
}

/** Apaga de verdade o arquivo. A dívida ligada a ele continua. */
export async function deleteDocument(form: FormData): Promise<void> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return;
  const id = String(form.get("id") ?? "");
  await withHousehold(ctx, (tx) => deleteDebtDocument(tx, ctx, id));
  revalidatePath("/app/dividas", "layout");
}

/** Aceite de mandar arquivos ao serviço de IA, dado na própria tela de importação. */
export async function acceptFiles(): Promise<{ ok: boolean; message: string | null }> {
  const { ctx } = await requireTenant();
  if (!canUseAssistant(ctx)) {
    return {
      ok: false,
      message: (await getTranslations("dividas.errors"))("acceptAdultsOnly"),
    };
  }
  await acceptDebtFiles(ctx, LEGAL_VERSION);
  revalidatePath("/app/dividas", "layout");
  return { ok: true, message: null };
}

const confirmSchema = (errors: Messages["dividas"]["errors"]) =>
  z.object({
    documentId: z.string().min(1),
    name: z.string().trim().min(1, errors.name).max(80),
    accountId: z.string().min(1, errors.account),
    target: z.string(),
  });

/** Conferência: só aqui o que veio do arquivo vira dívida, com os valores que a pessoa deixou. */
export async function confirmDebtImport(
  _prev: DebtFormState,
  form: FormData,
): Promise<DebtFormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return { ok: false, message: await readOnly() };
  const [t, locale, { dividas }] = await Promise.all([
    getTranslations("dividas"),
    getLocale(),
    getMessages(),
  ]);
  const common = confirmSchema(dividas.errors).safeParse({
    documentId: form.get("documentId") ?? "",
    name: form.get("name") ?? "",
    accountId: form.get("accountId") ?? "",
    target: form.get("target") ?? "",
  });
  const terms = parseDebtTerms(form, locale, dividas.errors);
  if (!common.success || !terms.ok) {
    return {
      ok: false,
      message: t("errors.checkFields"),
      fieldErrors: {
        ...(common.success ? {} : fieldErrors(common.error)),
        ...(terms.ok ? {} : terms.fieldErrors),
      },
    };
  }
  const { documentId, name, accountId, target } = common.data;
  const result = await withHousehold(ctx, (tx) =>
    confirmDebtDocument(tx, ctx, {
      documentId,
      name,
      accountId,
      terms: terms.terms,
      updateDebtId: target === "nova" ? null : target,
    }),
  );
  if (!result.ok) {
    return { ok: false, message: knownText(result.message, ptBR.dividas.upload, dividas.upload) };
  }
  revalidatePath("/app", "layout");
  return { ok: true, message: t(target === "nova" ? "created" : "updated") };
}
