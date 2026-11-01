"use server";
import {
  applySuggestion as apply,
  dismissSuggestion as dismiss,
  undoSuggestion as undo,
  type ApplyResult,
} from "@organizeup/agents";
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
import { requireTenant } from "@/lib/session";
import { BULK_KINDS, noticeCookie, secondsUntilMidnight } from "@/lib/suggestions";

const blocked: ApplyResult = {
  ok: false,
  message: "Seu papel nesta família não permite alterações.",
};

/** A lógica fica em @organizeup/agents; aqui só a sessão, a transação e a revalidação. */
async function decide(
  form: FormData,
  run: (tx: TenantTx, ctx: TenantContext, id: string) => Promise<ApplyResult>,
): Promise<ApplyResult> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return blocked;
  const id = String(form.get("id") ?? "");
  if (!id) return { ok: false, message: "Sugestão não encontrada." };
  const result = await withHousehold(ctx, (tx) => run(tx, ctx, id));
  if (result.ok) revalidatePath("/app", "layout");
  return result;
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
  if (!canWrite(ctx)) return blocked;
  const kind = bulkSchema.safeParse(form.get("kind"));
  if (!kind.success) return { ok: false, message: "Este tipo de sugestão é decidido uma a uma." };

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

  if (applied === 0)
    return { ok: false, message: "Nada foi aplicado. Atualize a página e tente de novo." };
  revalidatePath("/app", "layout");
  const done = `${applied} ${applied === 1 ? "aviso marcado como visto" : "avisos marcados como vistos"}.`;
  return {
    ok: true,
    message: failed > 0 ? `${done} ${failed} não ${failed === 1 ? "deu" : "deram"} certo.` : done,
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
