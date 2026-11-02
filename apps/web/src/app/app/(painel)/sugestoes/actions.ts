"use server";
import {
  applySuggestion as apply,
  dismissSuggestion as dismiss,
  undoSuggestion as undo,
  type ApplyResult,
  SUGGESTION_MODULE,
} from "@organizeup/agents";
import { canUse } from "@organizeup/domain";
import { getTranslations } from "next-intl/server";
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
  readFamilyAccess,
} from "@organizeup/db";
import { requireTenant } from "@/lib/session";
import { BULK_KINDS, noticeCookie, secondsUntilMidnight } from "@/lib/suggestions";

const blocked = async (): Promise<ApplyResult> => ({
  ok: false,
  message: (await getTranslations("settings"))("noPermission"),
});

/** Os agentes respondem por código: a mensagem chega à tela no idioma da pessoa. */
async function inLocale(result: ApplyResult): Promise<ApplyResult> {
  if (!result.code) return result;
  const t = await getTranslations("sugestoes.agent");
  const { code, values } = result;
  const message =
    code === "tripCreated" || code === "goalCreated" ? t(code, values ?? { name: "" }) : t(code);
  return { ...result, message };
}

async function moduleOff(ctx: TenantContext, id: string): Promise<boolean> {
  const access = await readFamilyAccess(ctx);
  return withHousehold(ctx, async (tx) => {
    const [row] = await tx
      .select({ kind: householdSuggestions.kind })
      .from(householdSuggestions)
      .where(eq(householdSuggestions.id, id));
    const owner = row ? SUGGESTION_MODULE[row.kind] : undefined;
    return owner !== undefined && !canUse(access, owner);
  });
}

/** A lógica fica em @organizeup/agents; aqui só a sessão, a transação e a revalidação. */
async function decide(
  form: FormData,
  run: (tx: TenantTx, ctx: TenantContext, id: string) => Promise<ApplyResult>,
  changesData = false,
): Promise<ApplyResult> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return blocked();
  const id = String(form.get("id") ?? "");
  if (!id) return { ok: false, message: (await getTranslations("sugestoes.agent"))("notFound") };
  // Sugestão de módulo desligado fica guardada, e dá para dispensar, mas não muda nada.
  if (changesData && (await moduleOff(ctx, id))) return blocked();
  const result = await withHousehold(ctx, (tx) => run(tx, ctx, id));
  if (result.ok) revalidatePath("/app", "layout");
  return inLocale(result);
}

export async function applySuggestion(form: FormData): Promise<ApplyResult> {
  return decide(form, apply, true);
}

export async function dismissSuggestion(form: FormData): Promise<ApplyResult> {
  return decide(form, dismiss);
}

export async function undoSuggestion(form: FormData): Promise<ApplyResult> {
  return decide(form, undo, true);
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
