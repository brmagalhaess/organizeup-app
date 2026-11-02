// Registro de ferramentas. A ordem é fixa (por nome): ferramentas ficam no começo do prefixo do cache.
import type { TenantContext } from "@organizeup/db";
import { canUse, type FamilyAccess } from "@organizeup/domain";
import { z } from "zod";
import type { AiRoute } from "../models";
import type { PrivacyFilter } from "../privacy";
import { WRITE_TOOLS } from "./escrita";
import { READ_TOOLS } from "./leitura";
import { KNOWLEDGE_TOOLS, MEMORY_TOOLS } from "./memoria";
import { toApiTool, type AssistantTool } from "./registry";
import { SIMULATION_TOOLS } from "./simulacao";

export { defineTool, toApiTool, type AssistantTool } from "./registry";

export const ALL_TOOLS: AssistantTool[] = [
  ...READ_TOOLS,
  ...KNOWLEDGE_TOOLS,
  ...SIMULATION_TOOLS,
  ...WRITE_TOOLS,
  ...MEMORY_TOOLS,
].sort((a, b) => a.name.localeCompare(b.name));

/**
 * Ferramentas da rota, cortadas pelo plano. Sem `access`, todas: é a conferência do painel, que não
 * fala de nenhuma família. `executeTool` só acha o que está aqui, então módulo desligado não roda.
 */
export const toolsFor = (route: Pick<AiRoute, "toolKinds">, access?: FamilyAccess) =>
  ALL_TOOLS.filter(
    (tool) =>
      route.toolKinds.includes(tool.kind) &&
      (!access || !tool.module || canUse(access, tool.module)),
  );

export const apiToolsFor = (route: Pick<AiRoute, "toolKinds">, access?: FamilyAccess) =>
  toolsFor(route, access).map(toApiTool);

export type ToolOutcome =
  | { ok: true; content: string; label: string; investment: boolean }
  | { ok: false; content: string; code: "invalid_input" | "unknown_tool" | "tool_failed" };

/**
 * `<` sai escapado: um texto de extrato não consegue fechar a marca e parecer instrução. O JSON
 * continua válido.
 */
const wrap = (data: unknown) =>
  `<dados_da_ferramenta>${JSON.stringify(data).replaceAll("<", "\\u003c")}</dados_da_ferramenta>`;

/**
 * Valida e roda uma ferramenta. A entrada vem do modelo e pode chegar truncada, por isso passa pelo
 * zod antes de qualquer coisa. Erro volta como texto curto para o modelo: nunca a mensagem original.
 */
export async function executeTool(
  tools: AssistantTool[],
  ctx: TenantContext,
  privacy: PrivacyFilter,
  name: string,
  rawInput: unknown,
): Promise<ToolOutcome> {
  const tool = tools.find((item) => item.name === name);
  if (!tool) {
    return { ok: false, code: "unknown_tool", content: `A ferramenta ${name} não existe.` };
  }
  const parsed = tool.input.safeParse(rawInput);
  if (!parsed.success) {
    const issues = z.flattenError(parsed.error);
    return {
      ok: false,
      code: "invalid_input",
      content: JSON.stringify({ entrada_invalida: issues }),
    };
  }
  try {
    const input = parsed.data as never;
    const data = await tool.run(ctx, input);
    return {
      ok: true,
      content: wrap(privacy.scrubDeep(data)),
      label: tool.label(input),
      investment: tool.investment === true,
    };
  } catch {
    return {
      ok: false,
      code: "tool_failed",
      content: "Não consegui ler esse dado agora. Diga isso à pessoa e não invente o valor.",
    };
  }
}
