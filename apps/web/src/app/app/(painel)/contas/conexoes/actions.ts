"use server";
import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import type { ParsedInvestmentFile, StatementRow } from "@organizeup/domain";
import {
  bankPortfolio,
  bankStatement,
  connectBank,
  linkBankAccount,
  markBankSynced,
  refreshBank,
  removeBank,
  requireBankFeed,
  type BankFeedFailure,
} from "@/lib/bank-feed";
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
    const result = await refreshBank(ctx, String(form.get("connectionId") ?? ""));
    revalidatePath(PAGE);
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
  const result = await linkBankAccount(ctx, String(form.get("linkId") ?? ""), accountId);
  if (!result.ok) return { ok: false, message: await problem(result.code) };
  revalidatePath(PAGE);
  revalidatePath("/app/importar");
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
  revalidatePath(PAGE);
  revalidatePath("/app/importar");
}

export type BankPortfolioResult =
  | { ok: true; file: ParsedInvestmentFile; paid: Record<string, string> }
  | { ok: false; message: string };

/** Posição em ativos de bolsa, para a conferência de /app/investimentos/importar. Não grava nada. */
export async function fetchBankPortfolio(): Promise<BankPortfolioResult> {
  const { ctx } = await requireBankFeed();
  try {
    const result = await bankPortfolio(ctx);
    if (!result.ok) return { ok: false, message: await problem(result.code) };
    return { ok: true, file: result.file, paid: result.paid };
  } catch (error) {
    return { ok: false, message: (await unexpected("bank_portfolio_failed", error)).message! };
  }
}
