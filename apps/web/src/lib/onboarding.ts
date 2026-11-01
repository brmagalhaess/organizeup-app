import "server-only";
import { z } from "zod";
import {
  calendarEvents,
  eq,
  householdSettings,
  WORK_STATUSES,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";
import {
  isYearMonth,
  money,
  parseBRL,
  parseMoney,
  toDbAmount,
  type MoneyValue,
} from "@organizeup/domain";
import { audit } from "./audit";

/** Sobe quando o cadastro complementar pedir dados novos: as famílias voltam a ver o convite. */
export const ONBOARDING_VERSION = 1;

export interface OnboardingStatus {
  version: number;
  completedAt: Date | null;
  pending: boolean;
}

export async function onboardingStatus(tx: TenantTx): Promise<OnboardingStatus> {
  const [row] = await tx
    .select({
      version: householdSettings.onboardingVersion,
      completedAt: householdSettings.onboardingCompletedAt,
    })
    .from(householdSettings)
    .limit(1);
  const version = row?.version ?? 0;
  return {
    version,
    completedAt: row?.completedAt ?? null,
    pending: version < ONBOARDING_VERSION,
  };
}

/** Campo numérico opcional: vazio vira null. */
export const optionalInt = (min: number, max: number, message: string) =>
  z
    .string()
    .trim()
    .transform((value, ctx): number | null => {
      if (value === "") return null;
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed >= min && parsed <= max) return parsed;
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    });

/**
 * Valor opcional digitado: vazio vira null, o resto vai para o banco com 2 casas. Sem `parse`, lê em
 * pt-BR, como em /app/completar.
 */
export const optionalAmount = (
  message: string,
  limits: { positive?: boolean; max?: string; parse?: (value: string) => MoneyValue } = {},
) =>
  z
    .string()
    .trim()
    .transform((value, ctx): string | null => {
      if (value === "") return null;
      try {
        const amount = toDbAmount((limits.parse ?? parseBRL)(value));
        const parsed = money(amount);
        const tooLow = limits.positive ? parsed.lte(0) : parsed.lt(0);
        if (tooLow || parsed.gt(limits.max ?? "999999999999")) throw new RangeError("fora");
        return amount;
      } catch {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
    });

export const birthField = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value))
  .refine((value) => {
    if (value === null) return true;
    const year = Number(value.slice(0, 4));
    return isYearMonth(value) && year >= 1900 && year <= 2100;
  }, "Use mês/ano válidos.");

export function birthParts(birth: string | null) {
  if (!birth) return { birthYear: null, birthMonth: null };
  const [birthYear, birthMonth] = birth.split("-").map(Number) as [number, number];
  return { birthYear, birthMonth };
}

/** Só titular e cônjuge entram no plano de aposentadoria; dos demais guardamos o mínimo. */
export function isPlanAdult(relation: string) {
  return relation === "titular" || relation === "conjuge";
}

export const adultProfileShape = {
  workStatus: z.preprocess(
    (value) => (value === "" ? null : value),
    z.enum(WORK_STATUSES, { message: "Escolha a situação de trabalho." }).nullable(),
  ),
  inssContributor: z
    .enum(["", "sim", "nao"], { message: "Escolha uma opção." })
    .transform((value) => (value === "" ? null : value === "sim")),
  expectedPension: optionalAmount("Informe o benefício como 2.500,00."),
};

/** O mesmo perfil com o benefício digitado no idioma da pessoa, para /app/familia. */
export const adultProfileShapeIn = (locale: string) => ({
  ...adultProfileShape,
  expectedPension: optionalAmount("Informe o benefício como 2.500,00.", {
    parse: (value) => parseMoney(value, locale),
  }),
});

export const planShape = {
  retirementYear: optionalInt(1950, 2150, "Informe um ano entre 1950 e 2150."),
  tripsPerYear: optionalInt(0, 12, "Informe de 0 a 12 viagens por ano."),
  tripDays: optionalInt(1, 60, "Informe de 1 a 60 dias."),
};

function isRealDate(day: number, month: number, year: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Único texto de `weddingDay` que não é o de faixa: quem traduz precisa distinguir os dois. */
export const NO_SUCH_DAY = "Esse dia não existe.";

export const weddingSchema = z
  .object({
    weddingDay: optionalInt(1, 31, "Informe um dia de 1 a 31."),
    weddingMonth: optionalInt(1, 12, "Escolha o mês."),
    weddingYear: optionalInt(1900, 2100, "Informe um ano entre 1900 e 2100."),
  })
  .superRefine(({ weddingDay, weddingMonth, weddingYear }, ctx) => {
    if (weddingDay === null) return;
    if (weddingMonth === null) {
      ctx.addIssue({ code: "custom", path: ["weddingMonth"], message: "Escolha o mês." });
    } else if (!isRealDate(weddingDay, weddingMonth, weddingYear ?? 2024)) {
      ctx.addIssue({ code: "custom", path: ["weddingDay"], message: NO_SUCH_DAY });
    }
  });

export type WeddingInput = z.output<typeof weddingSchema>;

/** Sem ano informado, o evento nasce neste ano (29/02 precisa de um ano bissexto). */
function weddingEventDate(day: number, month: number, year: number | null) {
  const leapDay = month === 2 && day === 29;
  const base = year ?? (leapDay ? 2024 : new Date().getUTCFullYear());
  return `${String(base).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Grava campos de household_settings, criando a linha se a família ainda não tiver. */
export async function patchSettings(
  tx: TenantTx,
  ctx: TenantContext,
  values: Partial<Omit<typeof householdSettings.$inferInsert, "householdId">>,
) {
  await tx
    .insert(householdSettings)
    .values({ householdId: ctx.householdId, ...values })
    .onConflictDoUpdate({
      target: householdSettings.householdId,
      set: { ...values, updatedAt: new Date() },
    });
}

/**
 * Grava o casamento. Com dia e mês mantém o evento anual "Aniversário de casamento" (criado sempre
 * por esta ação da família, nunca pelo assistente); sem o dia, o evento sai do calendário.
 */
export async function saveWedding(tx: TenantTx, ctx: TenantContext, wedding: WeddingInput) {
  const { weddingDay, weddingMonth, weddingYear } = wedding;
  const [current] = await tx
    .select({ eventId: householdSettings.weddingEventId })
    .from(householdSettings)
    .limit(1);
  let eventId = current?.eventId ?? null;

  if (weddingDay !== null && weddingMonth !== null) {
    const eventDate = weddingEventDate(weddingDay, weddingMonth, weddingYear);
    if (eventId) {
      await tx.update(calendarEvents).set({ eventDate }).where(eq(calendarEvents.id, eventId));
    } else {
      const [created] = await tx
        .insert(calendarEvents)
        .values({
          householdId: ctx.householdId,
          title: "Aniversário de casamento",
          eventDate,
          yearly: true,
          createdBy: ctx.userId,
        })
        .returning({ id: calendarEvents.id });
      eventId = created!.id;
      await audit(tx, ctx, "create", "calendar_events", eventId);
    }
  } else if (eventId) {
    await tx.delete(calendarEvents).where(eq(calendarEvents.id, eventId));
    await audit(tx, ctx, "delete", "calendar_events", eventId);
    eventId = null;
  }

  await patchSettings(tx, ctx, { weddingDay, weddingMonth, weddingYear, weddingEventId: eventId });
}

/** Marca o cadastro complementar da versão atual como resolvido (concluído ou dispensado). */
export async function markOnboardingDone(tx: TenantTx, ctx: TenantContext) {
  await patchSettings(tx, ctx, {
    onboardingVersion: ONBOARDING_VERSION,
    onboardingCompletedAt: new Date(),
  });
  await audit(tx, ctx, "onboarding", "household_settings", ctx.householdId);
}
