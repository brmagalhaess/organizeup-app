"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  and,
  eq,
  isNull,
  auditLog,
  canWrite,
  householdSettings,
  people,
  PERSON_RELATIONS,
  withHousehold,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";
import { isValidTimezone } from "@organizeup/domain";
import { requireTenant } from "@/lib/session";

export interface ActionState {
  ok: boolean;
  message: string | null;
  fieldErrors?: Record<string, string>;
}

function audit(
  tx: TenantTx,
  ctx: TenantContext,
  action: string,
  entity: string,
  entityId?: string,
) {
  return tx.insert(auditLog).values({
    householdId: ctx.householdId,
    actorUserId: ctx.userId,
    actorKind: "user",
    action,
    entity,
    entityId: entityId ?? null,
  });
}

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

const settingsSchema = z.object({
  city: optionalText(80),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || /^[A-Z]{2}$/.test(v), "Use a sigla do estado (ex.: SP)."),
  timezone: z.string().trim().refine(isValidTimezone, "Fuso horário inválido."),
});

/**
 * Prepara um household recém-criado: configurações + pessoa titular (o próprio usuário).
 * Idempotente.
 */
export async function bootstrapHousehold(input: {
  city?: string;
  state?: string;
}): Promise<ActionState> {
  const { session, ctx } = await requireTenant();
  if (ctx.role !== "owner") return { ok: false, message: "Somente o responsável pode configurar." };
  const parsed = settingsSchema.safeParse({
    city: input.city ?? "",
    state: input.state ?? "",
    timezone: "America/Sao_Paulo",
  });
  if (!parsed.success)
    return { ok: false, message: "Dados inválidos.", fieldErrors: fieldErrors(parsed.error) };

  await withHousehold(ctx, async (tx) => {
    await tx
      .insert(householdSettings)
      .values({ householdId: ctx.householdId, ...parsed.data })
      .onConflictDoNothing();
    const existing = await tx
      .select({ id: people.id })
      .from(people)
      .where(eq(people.userId, session.user.id))
      .limit(1);
    if (existing.length === 0) {
      const [person] = await tx
        .insert(people)
        .values({
          householdId: ctx.householdId,
          name: session.user.name,
          relation: "titular",
          userId: session.user.id,
        })
        .returning({ id: people.id });
      await tx
        .update(householdSettings)
        .set({ primaryPersonId: person!.id })
        .where(
          and(
            eq(householdSettings.householdId, ctx.householdId),
            isNull(householdSettings.primaryPersonId),
          ),
        );
      await audit(tx, ctx, "create", "people", person!.id);
    }
    await audit(tx, ctx, "bootstrap", "household", ctx.householdId);
  });
  revalidatePath("/app");
  return { ok: true, message: null };
}

const personSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(120),
  relation: z.enum(PERSON_RELATIONS, { message: "Escolha a relação." }),
  birth: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || /^\d{4}-\d{2}$/.test(v), "Use mês/ano válidos."),
});

export async function addPerson(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx))
    return { ok: false, message: "Seu papel nesta família não permite alterações." };
  const parsed = personSchema.safeParse({
    name: formData.get("name") ?? "",
    relation: formData.get("relation") ?? "",
    birth: formData.get("birth") ?? "",
  });
  if (!parsed.success) return { ok: false, message: null, fieldErrors: fieldErrors(parsed.error) };
  const [year, month] = parsed.data.birth ? parsed.data.birth.split("-").map(Number) : [null, null];

  await withHousehold(ctx, async (tx) => {
    const [person] = await tx
      .insert(people)
      .values({
        householdId: ctx.householdId,
        name: parsed.data.name,
        relation: parsed.data.relation,
        birthYear: year ?? null,
        birthMonth: month ?? null,
      })
      .returning({ id: people.id });
    await audit(tx, ctx, "create", "people", person!.id);
  });
  revalidatePath("/app");
  return { ok: true, message: "Pessoa adicionada." };
}

export async function updateSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx))
    return { ok: false, message: "Seu papel nesta família não permite alterações." };
  const parsed = settingsSchema.safeParse({
    city: formData.get("city") ?? "",
    state: formData.get("state") ?? "",
    timezone: formData.get("timezone") ?? "",
  });
  if (!parsed.success) return { ok: false, message: null, fieldErrors: fieldErrors(parsed.error) };

  await withHousehold(ctx, async (tx) => {
    await tx
      .insert(householdSettings)
      .values({ householdId: ctx.householdId, ...parsed.data })
      .onConflictDoUpdate({
        target: householdSettings.householdId,
        set: { ...parsed.data, updatedAt: new Date() },
      });
    await audit(tx, ctx, "update", "household_settings", ctx.householdId);
  });
  revalidatePath("/app");
  return { ok: true, message: "Configurações salvas." };
}
