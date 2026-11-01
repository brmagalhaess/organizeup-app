"use server";
import type { Messages } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { calendarEvents, canWrite, eq, withHousehold } from "@organizeup/db";
import { audit } from "@/lib/audit";
import { requireTenant } from "@/lib/session";

export interface EventFormState {
  ok: boolean;
  message: string | null;
}

const schema = (errors: Messages["calendario"]["errors"]) =>
  z.object({
    title: z.string().trim().min(1, errors.title).max(120),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, errors.date)
      .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), errors.date),
    yearly: z.boolean(),
  });

export async function saveEvent(_prev: EventFormState, form: FormData): Promise<EventFormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx))
    return { ok: false, message: (await getTranslations("settings"))("noPermission") };
  const t = await getTranslations("calendario");
  const parsed = schema((await getMessages()).calendario.errors).safeParse({
    title: form.get("title") ?? "",
    date: form.get("date") ?? "",
    yearly: form.get("yearly") === "on",
  });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? t("errors.check") };
  const { title, date, yearly } = parsed.data;
  await withHousehold(ctx, async (tx) => {
    const [created] = await tx
      .insert(calendarEvents)
      .values({
        householdId: ctx.householdId,
        title,
        eventDate: date,
        yearly,
        createdBy: ctx.userId,
      })
      .returning({ id: calendarEvents.id });
    await audit(tx, ctx, "create", "calendar_events", created!.id);
  });
  revalidatePath("/app", "layout");
  return { ok: true, message: t("event.saved") };
}

export async function deleteEvent(form: FormData): Promise<void> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return;
  const id = String(form.get("id") ?? "");
  await withHousehold(ctx, async (tx) => {
    const removed = await tx
      .delete(calendarEvents)
      .where(eq(calendarEvents.id, id))
      .returning({ id: calendarEvents.id });
    if (removed.length > 0) await audit(tx, ctx, "delete", "calendar_events", id);
  });
  revalidatePath("/app", "layout");
}
