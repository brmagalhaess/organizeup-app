"use server";
import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { FeedAssetClass, ParsedInvestmentFile, StatementRow } from "@organizeup/domain";
import {
  bankPortfolio,
  bankStatement,
  connectBank,
  createMissingAccounts,
  linkBankAccount,
  linkBankCard,
  markBankSynced,
  refreshBank,
  removeBank,
  requireBankFeed,
  setBankAuto,
  type BankFeedFailure,
} from "@/lib/bank-feed";
import { alignBankBalances, alignBankLink } from "@/lib/bank-auto";
import { pairBankTransfers } from "@/lib/bank-transfers";
import { commitCardFeed, prepareCardFeed, type PreparedCardRow } from "@/lib/bank-feed-cards";
import { reportActionFailure } from "@/lib/diagnostics";

export interface ConnectionFormState {
  ok: boolean;
  message: string | null;
}

const PAGE = "/app/contas/conexoes";

async function problem(code: BankFeedFailure): Promise<string> {
  return (await getTranslations("conexoes.errors"))(code);
}

/** Falha inesperada: só o nome e o código vão para o log. A pessoa vê uma frase, nunca o erro. */
async function unexpected(event: string, error: unknown): Promise<ConnectionFormState> {
  const { name, code } = error as { name?: string; code?: string };
  console.error(JSON.stringify({ level: "error", msg: event, name, code }));
  reportActionFailure(event, error);
  return { ok: false, message: await problem("rede") };
}

/**
 * Acerta o saldo das contas ligadas pelo do banco, sem deixar uma falha da Pluggy estragar a ação que já deu
 * certo: o saldo fica como estava e a próxima rodada tenta de novo.
 */
async function settleBalances(work: () => Promise<number>): Promise<void> {
  await work().catch((error: unknown) => {
    const { name, code } = error as { name?: string; code?: string };
    console.error(JSON.stringify({ level: "error", msg: "bank_balance_failed", name, code }));
  });
}

/** Confere as chaves na Pluggy e guarda a conexão, cifrada. */
export async function saveBankConnection(
  _previous: ConnectionFormState,
  form: FormData,
): Promise<ConnectionFormState> {
  const { ctx } = await requireBankFeed();
  try {
    const result = await connectBank(ctx, {
      connectionId: String(form.get("connectionId") ?? "") || null,
      personId: String(form.get("personId") ?? ""),
      consent: form.get("consent") === "on",
      clientId: String(form.get("clientId") ?? ""),
      clientSecret: String(form.get("clientSecret") ?? ""),
      itemIds: String(form.get("itemIds") ?? ""),
    });
    if (!result.ok) return { ok: false, message: await problem(result.code) };
    revalidatePath(PAGE);
    const t = await getTranslations("conexoes");
    return { ok: true, message: t("saved", { count: result.accounts }) };
  } catch (error) {
    return unexpected("bank_connection_save_failed", error);
  }
}

/** Lê de novo as contas de uma chave guardada. */
export async function refreshBankConnection(
  _previous: ConnectionFormState,
  form: FormData,
): Promise<ConnectionFormState> {
  const { ctx } = await requireBankFeed();
  try {
    const connectionId = String(form.get("connectionId") ?? "");
    const result = await refreshBank(ctx, connectionId);
    if (result.ok) {
      // Aproveita para juntar saída e entrada entre contas da casa que já estavam lançadas (ADR-0042).
      await settleBalances(() => pairBankTransfers(ctx));
      await settleBalances(() => alignBankBalances(ctx, connectionId));
    }
    revalidatePath("/app", "layout");
    if (!result.ok) return { ok: false, message: await problem(result.code) };
    const t = await getTranslations("conexoes");
    return { ok: true, message: t("refreshed", { count: result.accounts }) };
  } catch (error) {
    return unexpected("bank_connection_refresh_failed", error);
  }
}

/** Liga a conta do banco a uma conta do OrganizeUp, ou desfaz a ligação. */
export async function linkBank(
  _previous: ConnectionFormState,
  form: FormData,
): Promise<ConnectionFormState> {
  const { ctx } = await requireBankFeed();
  const accountId = String(form.get("accountId") ?? "");
  const linkId = String(form.get("linkId") ?? "");
  const result = await linkBankAccount(ctx, linkId, accountId);
  if (!result.ok) return { ok: false, message: await problem(result.code) };
  if (accountId) await settleBalances(() => alignBankLink(ctx, linkId));
  revalidatePath("/app", "layout");
  const t = await getTranslations("conexoes");
  return { ok: true, message: t(accountId ? "linked" : "unlinked") };
}

/** Apaga uma chave e as contas dela. O que já foi importado fica. */
export async function removeBankConnection(form: FormData): Promise<void> {
  const { ctx } = await requireBankFeed();
  await removeBank(ctx, String(form.get("id") ?? ""));
  revalidatePath(PAGE);
  revalidatePath("/app/importar");
}

export type BankStatementResult =
  | {
      ok: true;
      linkId: string;
      accountId: string;
      rows: StatementRow[];
      pending: number;
      truncated: boolean;
      from: string;
      to: string;
    }
  | { ok: false; message: string };

/** Lançamentos de uma conta ligada, para a conferência de /app/importar. Não grava nada. */
export async function fetchBankStatement(input: {
  linkId: string;
  from: string | null;
}): Promise<BankStatementResult> {
  const { ctx } = await requireBankFeed();
  const from = input.from && /^\d{4}-\d{2}-\d{2}$/.test(input.from) ? input.from : null;
  try {
    const result = await bankStatement(ctx, String(input.linkId), from);
    if (!result.ok) return { ok: false, message: await problem(result.code) };
    const { linkId, accountId, rows, pending, truncated, to } = result;
    return { ok: true, linkId, accountId, rows, pending, truncated, from: result.from, to };
  } catch (error) {
    return { ok: false, message: (await unexpected("bank_statement_failed", error)).message! };
  }
}

/** Depois de gravar a importação: a próxima busca da conta parte deste dia. */
export async function confirmBankSync(linkId: string, day: string): Promise<void> {
  const { ctx } = await requireBankFeed();
  await markBankSynced(ctx, String(linkId), String(day));
  // O que acabou de entrar pode ser a outra ponta de uma transferência entre contas da casa (ADR-0042).
  await settleBalances(() => pairBankTransfers(ctx));
  // O que acabou de entrar muda a soma da conta: o saldo volta a bater com o do banco.
  await settleBalances(() => alignBankLink(ctx, String(linkId)));
  revalidatePath("/app", "layout");
}

export type BankPortfolioResult =
  | {
      ok: true;
      file: ParsedInvestmentFile;
      paid: Record<string, string>;
      estimated: string[];
      classes: Record<string, FeedAssetClass>;
    }
  | { ok: false; message: string };

/** Posição em ativos de bolsa, para a conferência de /app/investimentos/importar. Não grava nada. */
export async function fetchBankPortfolio(): Promise<BankPortfolioResult> {
  const { ctx } = await requireBankFeed();
  try {
    const result = await bankPortfolio(ctx);
    if (!result.ok) return { ok: false, message: await problem(result.code) };
    const { file, paid, estimated, classes } = result;
    return { ok: true, file, paid, estimated, classes };
  } catch (error) {
    return { ok: false, message: (await unexpected("bank_portfolio_failed", error)).message! };
  }
}

/** Cria, de uma vez, a conta do OrganizeUp de cada conta do banco que ainda não tem ligação. */
export async function createBankAccounts(
  _previous: ConnectionFormState,
  form: FormData,
): Promise<ConnectionFormState> {
  const { ctx } = await requireBankFeed();
  const connectionId = String(form.get("connectionId") ?? "");
  const result = await createMissingAccounts(ctx, connectionId);
  if (!result.ok) return { ok: false, message: await problem(result.code) };
  await settleBalances(() => alignBankBalances(ctx, connectionId));
  revalidatePath("/app", "layout");
  const t = await getTranslations("conexoes");
  return { ok: true, message: t("accountsCreated", { count: result.created }) };
}

/** Liga o cartão do banco a um cartão do OrganizeUp, criando o cartão quando pedido. */
export async function linkCard(
  _previous: ConnectionFormState,
  form: FormData,
): Promise<ConnectionFormState> {
  const { ctx } = await requireBankFeed();
  const cardId = String(form.get("cardId") ?? "");
  const day = (name: string) => Number(String(form.get(name) ?? "").trim() || Number.NaN);
  const result = await linkBankCard(ctx, String(form.get("linkId") ?? ""), {
    cardId,
    closingDay: day("closingDay"),
    dueDay: day("dueDay"),
    payingAccountId: String(form.get("payingAccountId") ?? ""),
  });
  if (!result.ok) return { ok: false, message: await problem(result.code) };
  revalidatePath("/app", "layout");
  const t = await getTranslations("conexoes");
  return { ok: true, message: t(cardId ? "cardLinked" : "unlinked") };
}

export type CardStatementResult =
  | {
      ok: true;
      linkId: string;
      rows: PreparedCardRow[];
      pending: number;
      credits: number;
      truncated: boolean;
      to: string;
    }
  | { ok: false; message: string };

/** Compras de um cartão ligado, para a conferência de /app/importar. Não grava nada. */
export async function fetchCardStatement(input: {
  linkId: string;
  from: string | null;
}): Promise<CardStatementResult> {
  const { ctx } = await requireBankFeed();
  const from = input.from && /^\d{4}-\d{2}-\d{2}$/.test(input.from) ? input.from : null;
  try {
    const result = await prepareCardFeed(ctx, String(input.linkId), from);
    if (!result.ok) return { ok: false, message: await problem(result.code) };
    const { linkId, rows, pending, credits, truncated, to } = result;
    return { ok: true, linkId, rows, pending, credits, truncated, to };
  } catch (error) {
    return { ok: false, message: (await unexpected("bank_card_statement_failed", error)).message! };
  }
}

const cardCommitSchema = z.object({
  linkId: z.string().min(1).max(100),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rows: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        description: z.string().trim().min(1).max(120),
        amount: z.string().regex(/^\d{1,12}\.\d{2}$/),
        installments: z.number().int().min(1).max(120),
        fingerprint: z.string().min(1).max(300),
        categoryId: z.string().min(1).max(100).nullable(),
        newCategory: z
          .object({ name: z.string().trim().min(1).max(60), essential: z.boolean() })
          .nullable(),
      }),
    )
    .min(1)
    .max(2000),
});

export type CardCommitResult =
  { ok: true; imported: number; summary: string } | { ok: false; message: string };

/** Grava as compras escolhidas na conferência e anota até onde o cartão foi trazido. */
export async function commitCardStatement(
  input: z.input<typeof cardCommitSchema>,
): Promise<CardCommitResult> {
  const { ctx } = await requireBankFeed();
  const parsed = cardCommitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: await problem("dados_invalidos") };
  try {
    const result = await commitCardFeed(ctx, parsed.data.linkId, parsed.data.rows);
    if (!result.ok) return { ok: false, message: await problem(result.code) };
    await markBankSynced(ctx, parsed.data.linkId, parsed.data.to);
    revalidatePath("/app", "layout");
    const t = await getTranslations("conexoes.cardImport");
    const notes = [
      result.repeated > 0 ? t("repeated", { count: result.repeated }) : null,
      result.blocked > 0 ? t("blocked", { count: result.blocked }) : null,
    ].filter(Boolean);
    return { ok: true, imported: result.imported, summary: notes.join(" ") };
  } catch (error) {
    return { ok: false, message: (await unexpected("bank_card_commit_failed", error)).message! };
  }
}

/** Liga ou desliga a atualização automática de uma chave. */
export async function toggleBankAuto(
  _previous: ConnectionFormState,
  form: FormData,
): Promise<ConnectionFormState> {
  const { ctx } = await requireBankFeed();
  const enabled = form.get("enabled") === "true";
  const result = await setBankAuto(ctx, String(form.get("connectionId") ?? ""), enabled);
  if (!result.ok) return { ok: false, message: await problem(result.code) };
  revalidatePath(PAGE);
  const t = await getTranslations("conexoes.auto");
  return { ok: true, message: t(enabled ? "turnedOn" : "turnedOff") };
}
