import { hasAgentRunToday, readPlatformFlags } from "@organizeup/db";
import { todayIn } from "@organizeup/domain";
import { after } from "next/server";
import { z } from "zod";
import { DAILY_AGENTS_INFO } from "@/app/admin/agentes/info";
import { BANCOS_AGENT, LEMBRETES_AGENT } from "@/app/admin/agentes/catalogo";
import { DICAS_AGENT, MERCADO_AGENT, queueAgent } from "@/app/admin/fila";
import { syncAllBanks } from "@/lib/bank-auto";
import { reportActionFailure } from "@/lib/diagnostics";
import { isAuthorizedOpsRequest } from "@/lib/ops-auth";
import { sendAllReminders } from "@/lib/reminders";

export const dynamic = "force-dynamic";

const body = z.strictObject({
  // `categorias_ia` é o nome de antes: quem ainda chama por ele não fica sem resposta.
  agent: z.preprocess(
    (agent) => (agent === "categorias_ia" ? "categorias-ia" : agent),
    z.enum([
      ...DAILY_AGENTS_INFO.map((agent) => agent.id),
      MERCADO_AGENT,
      DICAS_AGENT,
      BANCOS_AGENT,
      LEMBRETES_AGENT,
    ]),
  ),
});

/**
 * Ops API: o Paperclip acorda um agente diário. O trabalho roda no worker, dentro da família. Daqui
 * só saem o nome do agente e o motivo: o resultado volta em `agentRuns` de `/api/ops/context`.
 */
export async function POST(request: Request) {
  if (!isAuthorizedOpsRequest(request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  const { agent } = parsed.data;
  const day = todayIn();

  const flags = await readPlatformFlags();
  if (flags.maintenance) return Response.json({ queued: false, agent, day, reason: "manutencao" });
  if (flags.disabledAgents.includes(agent)) {
    return Response.json({ queued: false, agent, day, reason: "desligado" });
  }
  // As fontes públicas não declaram cota: quem já rodou no horário do worker não repete a rodada.
  if (agent === MERCADO_AGENT && (await hasAgentRunToday(day, agent))) {
    return Response.json({ queued: false, agent, day, reason: "ja_rodou" });
  }
  // Bancos e Lembretes rodam aqui mesmo, depois da resposta: a chave do cofre e a do e-mail só existem na
  // web, nunca no worker. O lembrete sai depois de Bancos, para o gasto que acabou de chegar entrar no aviso.
  const remind = () =>
    sendAllReminders().catch((error) => reportActionFailure("reminder_failed", error));
  if (agent === BANCOS_AGENT) {
    const alsoRemind = !flags.disabledAgents.includes(LEMBRETES_AGENT);
    after(async () => {
      await syncAllBanks().catch((error) => reportActionFailure("bank_auto_failed", error));
      if (alsoRemind) await remind();
    });
    return Response.json({ queued: true, agent, day, reason: null });
  }
  if (agent === LEMBRETES_AGENT) {
    after(remind);
    return Response.json({ queued: true, agent, day, reason: null });
  }
  const job = await queueAgent(agent);
  return Response.json({ queued: Boolean(job), agent, day, reason: job ? null : "ja_pedido" });
}
