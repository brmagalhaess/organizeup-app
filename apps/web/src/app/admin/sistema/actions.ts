"use server";
import { assistantConfigured, checkModel, createModelClient, monthSpend } from "@organizeup/ai";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { AI_TEST_FAILED, AI_TEST_OK } from "../auditoria/labels";
import { noteAdminAccess, runAdminAction } from "../painel";
import { done, failed, type AdminResult } from "../painel-result";

const REASONS: Record<string, string> = {
  "sem-credito": "a conta da API está sem crédito",
  "sem-workspace": "falta ANTHROPIC_WORKSPACE_ID em ou3-web",
  "beta-recusado": "a API não liberou um recurso que o sistema pede",
  recusa: "o modelo recusou a pergunta de teste",
  "sem-fim": "o modelo não terminou em três passos",
  falha: "a conexão falhou",
};

async function checkAssistant(): Promise<AdminResult> {
  if (!assistantConfigured()) return failed("Falta ANTHROPIC_API_KEY em ou3-web.");
  if ((await monthSpend()).reached) return failed("O teto do mês foi atingido.");
  const check = await checkModel(createModelClient());
  if (check.ok) {
    const tool = check.toolUsed ? "com ida e volta de ferramenta" : "sem usar ferramenta";
    return done(`Funcionou em ${check.steps} chamadas, ${tool}. Modelo: ${check.model}.`);
  }
  const reason = (check.reason && REASONS[check.reason]) ?? `campo ${check.reason ?? "?"}`;
  const status = check.status ? `Erro ${check.status}: ` : "";
  const detail = check.detail ? ` Resposta da API: ${check.detail}` : "";
  return failed(`${status}${reason}, no passo ${check.steps + 1}.${detail}`);
}

/** O resultado fica na auditoria: é de lá que sai o alerta de teste que falhou. */
export async function testAssistantModel(): Promise<AdminResult> {
  const session = await requireAdmin();
  return runAdminAction("admin_ai_test_failed", async () => {
    const result = await checkAssistant();
    await noteAdminAccess(session.user.id, result.ok ? AI_TEST_OK : AI_TEST_FAILED);
    revalidatePath("/admin", "layout");
    return result;
  });
}
