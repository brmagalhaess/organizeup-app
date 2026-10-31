"use server";
import { adminRecordAction, adminSetFlag, FLAG_KEYS } from "@organizeup/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { platformFlags, requireAdmin } from "@/lib/session";
import { queueDailyAgents, queuePlatformStats } from "../fila";
import { runAdminAction } from "../painel";
import { done, failed, type AdminResult } from "../painel-result";
import { DAILY_AGENTS_INFO } from "./info";

const agentId = z.enum(DAILY_AGENTS_INFO.map((agent) => agent.id));

/** Ligar e desligar: o worker confere a chave no começo de cada rodada. */
export async function toggleAgent(form: FormData): Promise<AdminResult> {
  const session = await requireAdmin();
  const parsed = z
    .object({ agent: agentId, enabled: z.enum(["true", "false"]) })
    .safeParse({ agent: form.get("agent"), enabled: form.get("enabled") });
  if (!parsed.success) return failed("Agente inválido.");
  const { agent, enabled } = parsed.data;
  const on = enabled === "true";
  return runAdminAction("admin_agent_toggle_failed", async () => {
    await adminSetFlag(
      { adminUserId: session.user.id },
      {
        key: FLAG_KEYS.agentOff(agent),
        enabled: !on,
        action: `agente:${on ? "ligar" : "desligar"}:${agent}`,
      },
    );
    revalidatePath("/admin", "layout");
    return done(on ? "Agente ligado." : "Agente desligado.");
  });
}

/** Mesma fila e mesma rotina da madrugada: só antecipa. Rodar de novo no dia dá o mesmo resultado. */
export async function runAgentsNow(): Promise<AdminResult> {
  const session = await requireAdmin();
  if ((await platformFlags()).maintenance) {
    return failed("Com o modo manutenção ligado, os agentes não rodam.");
  }
  return runAdminAction("admin_agents_run_failed", async () => {
    await adminRecordAction({ adminUserId: session.user.id }, "agentes:rodar");
    const job = await queueDailyAgents();
    return job
      ? done("Rodada pedida. O worker começa em instantes.")
      : done("Já existe uma rodada pedida há pouco.");
  });
}

export async function recountPlatform(): Promise<AdminResult> {
  const session = await requireAdmin();
  return runAdminAction("admin_stats_run_failed", async () => {
    await adminRecordAction({ adminUserId: session.user.id }, "agentes:contagens");
    const job = await queuePlatformStats();
    return job
      ? done("Contagem pedida. A visão geral atualiza em instantes.")
      : done("Já existe uma contagem pedida há pouco.");
  });
}
