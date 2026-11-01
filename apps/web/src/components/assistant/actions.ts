"use server";
import {
  activateAssistant,
  assistantConfigured,
  canUseAssistant,
  deactivateAssistant,
  setAssistantAutonomy,
} from "@organizeup/ai";
import { AI_AUTONOMY_LEVELS } from "@organizeup/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { LEGAL_VERSION } from "@/lib/legal";
import { requireTenant } from "@/lib/session";

export interface AssistantActionState {
  ok: boolean;
  message: string | null;
}

const NOT_ALLOWED = "Só quem é responsável ou adulto na família pode mudar isso.";
const FAILED = "Não foi possível salvar. Tente novamente.";
const autonomy = z.enum(AI_AUTONOMY_LEVELS);

const refresh = () => revalidatePath("/app", "layout");

export async function activate(
  _previous: AssistantActionState,
  form: FormData,
): Promise<AssistantActionState> {
  const { ctx } = await requireTenant();
  if (!canUseAssistant(ctx)) return { ok: false, message: NOT_ALLOWED };
  if (!assistantConfigured()) {
    return { ok: false, message: "O assistente está indisponível no momento." };
  }
  if (form.get("consent") !== "on") {
    return { ok: false, message: "Para ativar, marque que você leu e autoriza o envio." };
  }
  const level = autonomy.safeParse(form.get("autonomy"));
  if (!level.success) return { ok: false, message: "Escolha o que o assistente pode fazer." };
  try {
    await activateAssistant(ctx, { autonomy: level.data, version: LEGAL_VERSION });
  } catch {
    return { ok: false, message: FAILED };
  }
  refresh();
  return { ok: true, message: null };
}

/** Quem aceitou antes das dicas da madrugada aceita de novo, mantendo o nível escolhido. */
export async function acceptInsights(
  _previous: AssistantActionState,
  form: FormData,
): Promise<AssistantActionState> {
  const { ctx } = await requireTenant();
  if (!canUseAssistant(ctx)) return { ok: false, message: NOT_ALLOWED };
  if (form.get("consent") !== "on") {
    return { ok: false, message: "Para ligar as dicas, marque que você autoriza." };
  }
  const level = autonomy.safeParse(form.get("autonomy"));
  if (!level.success) return { ok: false, message: FAILED };
  try {
    await activateAssistant(ctx, { autonomy: level.data, version: LEGAL_VERSION });
  } catch {
    return { ok: false, message: FAILED };
  }
  refresh();
  return { ok: true, message: "Dicas ligadas. A primeira rodada sai na próxima madrugada." };
}

export async function deactivate(): Promise<void> {
  const { ctx } = await requireTenant();
  if (!canUseAssistant(ctx)) return;
  await deactivateAssistant(ctx);
  refresh();
}

export async function changeAutonomy(
  _previous: AssistantActionState,
  form: FormData,
): Promise<AssistantActionState> {
  const { ctx } = await requireTenant();
  if (!canUseAssistant(ctx)) return { ok: false, message: NOT_ALLOWED };
  const level = autonomy.safeParse(form.get("autonomy"));
  if (!level.success) return { ok: false, message: "Escolha uma opção." };
  try {
    await setAssistantAutonomy(ctx, level.data);
  } catch {
    return { ok: false, message: FAILED };
  }
  refresh();
  return { ok: true, message: "Salvo." };
}
