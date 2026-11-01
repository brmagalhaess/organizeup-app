"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { calendarEvents, canWrite, eq, withHousehold } from "@organizeup/db";
import { audit } from "@/lib/audit";
import { requireTenant } from "@/lib/session";

export interface EventFormState {
  ok: boolean;
  message: string | null;
}

const schema = z.object({
  title: z.string().trim().min(1, "Informe o nome do evento.").max(120),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.")
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Data inválida."),
  yearly: z.boolean(),
});

export async function saveEvent(_prev: EventFormState, form: FormData): Promise<EventFormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx))
    return { ok: false, message: "Seu papel nesta família não permite alterações." };
  const parsed = schema.safeParse({
    title: form.get("title") ?? "",
    date: form.get("date") ?? "",
    yearly: form.get("yearly") === "on",
  });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Verifique." };
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
  return { ok: true, message: "Evento salvo." };
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
