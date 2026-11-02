"use server";
import { undoSuggestion, type ApplyResult } from "@organizeup/agents";
import { canWrite, eq, householdNotifications, isNull, withHousehold } from "@organizeup/db";
import { SAVINGS_NOTICE_KEY } from "@organizeup/domain";
import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/session";

/** Desfaz a mudança que a notificação avisa. A regra é a mesma da tela Sugestões. */
export async function undoNotification(form: FormData): Promise<ApplyResult> {
  const { ctx } = await requireTenant();
  const t = await getTranslations("notificacoes");
  if (!canWrite(ctx)) return { ok: false, message: t("noPermission") };
  const id = String(form.get("id") ?? "");
  const result = await withHousehold(ctx, async (tx) => {
    const [row] = await tx
      .select({ suggestionId: householdNotifications.suggestionId })
      .from(householdNotifications)
      .where(eq(householdNotifications.id, id));
    return row?.suggestionId ? undoSuggestion(tx, ctx, row.suggestionId) : null;
  });
  if (!result?.ok) return { ok: false, message: t("undoFailed") };
  revalidatePath("/app", "layout");
  return { ok: true, message: t("undoDone") };
}

/** Marca tudo como lido, para a família inteira. Nada mais marca: abrir a tela não muda nada. */
export async function markAllRead(): Promise<ApplyResult> {
  const { ctx } = await requireTenant();
  const t = await getTranslations("notificacoes");
  if (!canWrite(ctx)) return { ok: false, message: t("noPermission") };
  await withHousehold(ctx, (tx) =>
    tx
      .update(householdNotifications)
      .set({ readAt: new Date() })
      .where(isNull(householdNotifications.readAt)),
  );
  revalidatePath("/app", "layout");
  return { ok: true, message: t("allRead") };
}

/** Fecha, para a família inteira, a nota do painel sobre aportes. A linha nasce lida: não é aviso novo. */
export async function dismissSavingsNotice(): Promise<void> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return;
  await withHousehold(ctx, (tx) =>
    tx
      .insert(householdNotifications)
      .values({
        householdId: ctx.householdId,
        kind: "aviso_painel",
        title: "Aportes separados",
        body: "Nota do painel fechada.",
        dedupeKey: SAVINGS_NOTICE_KEY,
        readAt: new Date(),
      })
      .onConflictDoNothing(),
  );
  revalidatePath("/app", "layout");
}
