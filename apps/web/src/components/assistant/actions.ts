"use server";
import {
  activateAssistant,
  assistantConfigured,
  canUseAssistant,
  deactivateAssistant,
  setAssistantAutonomy,
} from "@organizeup/ai";
import { AI_AUTONOMY_LEVELS } from "@organizeup/db";
import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { LEGAL_VERSION } from "@/lib/legal";
import { requireModule } from "@/lib/billing/plan-gate";
import { requireOwnData } from "@/lib/session";

export interface AssistantActionState {
  ok: boolean;
  message: string | null;
}

const autonomy = z.enum(AI_AUTONOMY_LEVELS);

const refresh = () => revalidatePath("/app", "layout");

export async function activate(
  _previous: AssistantActionState,
  form: FormData,
): Promise<AssistantActionState> {
  const { ctx } = await requireModule("assistente");
  const [t, tSettings] = await Promise.all([
    getTranslations("assistente.activation"),
    getTranslations("settings.assistant"),
  ]);
  if (!canUseAssistant(ctx)) return { ok: false, message: tSettings("notAllowed") };
  if (!assistantConfigured()) return { ok: false, message: t("unavailable") };
  if (form.get("consent") !== "on") return { ok: false, message: t("consentRequired") };
  const level = autonomy.safeParse(form.get("autonomy"));
  if (!level.success) return { ok: false, message: t("pickLevel") };
  try {
    await activateAssistant(ctx, { autonomy: level.data, version: LEGAL_VERSION });
  } catch {
    return { ok: false, message: tSettings("failed") };
  }
  refresh();
  return { ok: true, message: null };
}

/** Quem aceitou antes das dicas da madrugada aceita de novo, mantendo o nível escolhido. */
export async function acceptInsights(
  _previous: AssistantActionState,
  form: FormData,
): Promise<AssistantActionState> {
  const { ctx } = await requireModule("assistente");
  const t = await getTranslations("settings.assistant");
  if (!canUseAssistant(ctx)) return { ok: false, message: t("notAllowed") };
  if (form.get("consent") !== "on") return { ok: false, message: t("consentRequired") };
  const level = autonomy.safeParse(form.get("autonomy"));
  if (!level.success) return { ok: false, message: t("failed") };
  try {
    await activateAssistant(ctx, { autonomy: level.data, version: LEGAL_VERSION });
  } catch {
    return { ok: false, message: t("failed") };
  }
  refresh();
  return { ok: true, message: t("insightsOn") };
}

export async function deactivate(): Promise<void> {
  // Desligar vale em só leitura e sem o módulo: quem ligou pode voltar atrás.
  const { ctx } = await requireOwnData();
  if (!canUseAssistant(ctx)) return;
  await deactivateAssistant(ctx);
  refresh();
}

export async function changeAutonomy(
  _previous: AssistantActionState,
  form: FormData,
): Promise<AssistantActionState> {
  const { ctx } = await requireModule("assistente");
  const t = await getTranslations("settings.assistant");
  if (!canUseAssistant(ctx)) return { ok: false, message: t("notAllowed") };
  const level = autonomy.safeParse(form.get("autonomy"));
  if (!level.success) return { ok: false, message: t("pickOption") };
  try {
    await setAssistantAutonomy(ctx, level.data);
  } catch {
    return { ok: false, message: t("failed") };
  }
  refresh();
  return { ok: true, message: t("levelSaved") };
}
