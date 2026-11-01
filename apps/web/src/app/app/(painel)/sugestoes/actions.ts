"use server";
import {
  applySuggestion as apply,
  dismissSuggestion as dismiss,
  undoSuggestion as undo,
  type ApplyResult,
} from "@organizeup/agents";
import { getMessages, getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import {
  and,
  canWrite,
  eq,
  householdSuggestions,
  householdTimezone,
  withHousehold,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";
import { knownText } from "@/i18n/known-text";
import { requireTenant } from "@/lib/session";
import { BULK_KINDS, noticeCookie, secondsUntilMidnight } from "@/lib/suggestions";
import ptBR from "../../../../../messages/pt-BR.json";

const blocked = async (): Promise<ApplyResult> => ({
  ok: false,
  message: (await getTranslations("settings"))("noPermission"),
});

/** Os agentes respondem em português: a mensagem chega à tela no idioma da pessoa. */
async function inLocale(result: ApplyResult): Promise<ApplyResult> {
  const [t, { sugestoes }] = await Promise.all([
    getTranslations("sugestoes.applied"),
    getMessages(),
  ]);
  const text = result.message;
  const moved = /^(\d+) lançamentos movidos\.$/.exec(text)?.[1];
  const trip = /^Viagem para (.+) criada\. Ajuste datas e custos em Viagens\.$/.exec(text)?.[1];
  const goal = /^Meta (.+) criada\. Ajuste os detalhes em Metas\.$/.exec(text)?.[1];
  const message =
    text === "Lançamento movido."
      ? t("moved", { count: 1 })
      : moved
        ? t("moved", { count: Number(moved) })
        : trip
          ? t("tripCreated", { name: trip })
          : goal
            ? t("goalCreated", { name: goal })
            : knownText(text, ptBR.sugestoes.agent, sugestoes.agent);
  return { ...result, message };
}

/** A lógica fica em @organizeup/agents; aqui só a sessão, a transação e a revalidação. */
async function decide(
  form: FormData,
  run: (tx: TenantTx, ctx: TenantContext, id: string) => Promise<ApplyResult>,
): Promise<ApplyResult> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return blocked();
  const id = String(form.get("id") ?? "");
  if (!id) return inLocale({ ok: false, message: ptBR.sugestoes.errors.notFound });
  const result = await withHousehold(ctx, (tx) => run(tx, ctx, id));
  if (result.ok) revalidatePath("/app", "layout");
  return inLocale(result);
}

export async function applySuggestion(form: FormData): Promise<ApplyResult> {
  return decide(form, apply);
}

export async function dismissSuggestion(form: FormData): Promise<ApplyResult> {
  return decide(form, dismiss);
}

export async function undoSuggestion(form: FormData): Promise<ApplyResult> {
  return decide(form, undo);
}

const bulkSchema = z.enum(BULK_KINDS);

/** Aceita de uma vez todas as pendentes de um tipo. Só para tipos que não decidem sobre dinheiro. */
export async function applyAll(form: FormData): Promise<ApplyResult> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return blocked();
  const t = await getTranslations("sugestoes");
  const kind = bulkSchema.safeParse(form.get("kind"));
  if (!kind.success) return { ok: false, message: t("errors.oneByOne") };

  const { applied, failed } = await withHousehold(ctx, async (tx) => {
    const rows = await tx
      .select({ id: householdSuggestions.id })
      .from(householdSuggestions)
      .where(
        and(eq(householdSuggestions.status, "pendente"), eq(householdSuggestions.kind, kind.data)),
      );
    const totals = { applied: 0, failed: 0 };
    for (const row of rows) {
      const result = await apply(tx, ctx, row.id);
      if (result.ok) totals.applied += 1;
      else totals.failed += 1;
    }
    return totals;
  });

  if (applied === 0) return { ok: false, message: t("errors.nothingApplied") };
  revalidatePath("/app", "layout");
  const done = t("applied.seen", { count: applied });
  return {
    ok: true,
    message: failed > 0 ? `${done} ${t("applied.failed", { count: failed })}` : done,
  };
}

/** Esconde o aviso do shell até o fim do dia, no fuso da família. */
export async function dismissNotice(form: FormData): Promise<void> {
  const { ctx } = await requireTenant();
  const key = String(form.get("key") ?? "");
  if (!/^[a-z0-9-]{1,40}$/.test(key)) return;
  const timezone = await withHousehold(ctx, (tx) => householdTimezone(tx, ctx.householdId));
  const store = await cookies();
  store.set(noticeCookie(key), "1", {
    maxAge: secondsUntilMidnight(timezone),
    path: "/app",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  revalidatePath("/app", "layout");
}
