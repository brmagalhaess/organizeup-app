// Registro único de ferramentas (§2 da especificação): nome, descrição, esquema zod e `(ctx, input)`.
// Cada ferramenta abre a própria transação curta; o modelo nunca é chamado dentro dela. Escrita entra
// aqui depois, com `kind: "escrita"`, sempre criando sugestão (regra 7).
import {
  householdTimezone,
  withHousehold,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";
import { todayIn } from "@organizeup/domain";
import { z } from "zod";
import type { ToolKind } from "../models";

export interface AssistantTool {
  name: string;
  /** Para o modelo: diz quando chamar. */
  description: string;
  kind: ToolKind;
  input: z.ZodType;
  /** Fala de investimento: a resposta leva o aviso da CVM. */
  investment?: boolean;
  /** Para a família, no passado: "olhei seus lançamentos de outubro". Nunca leva dado pessoal. */
  label(input: never): string;
  run(ctx: TenantContext, input: never): Promise<unknown>;
}

export function defineTool<S extends z.ZodType>(tool: {
  name: string;
  description: string;
  kind: ToolKind;
  input: S;
  investment?: boolean;
  label(input: z.infer<S>): string;
  run(ctx: TenantContext, input: z.infer<S>): Promise<unknown>;
}): AssistantTool {
  return tool as unknown as AssistantTool;
}

/** Transação curta com o dia de hoje no fuso da família. */
export const read = <T>(
  ctx: TenantContext,
  fn: (tx: TenantTx, today: string) => Promise<T>,
): Promise<T> =>
  withHousehold(ctx, async (tx) => fn(tx, todayIn(await householdTimezone(tx, ctx.householdId))));

export const monthInput = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use o formato AAAA-MM.")
  .optional()
  .describe("Mês no formato AAAA-MM. Sem ele, usa o mês atual.");

export const amountInput = (description: string) =>
  z
    .string()
    .regex(/^\d{1,10}(\.\d{1,2})?$/, "Use só números, com ponto decimal.")
    .describe(`${description} Em reais, só números, com ponto decimal: "500.00".`);

// O esquema enviado à API aceita menos que o zod: limites e padrões ficam só na validação local.
const UNSUPPORTED = new Set([
  "$schema",
  "pattern",
  "format",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minItems",
  "maxItems",
]);

function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !UNSUPPORTED.has(key))
        .map(([key, item]) => [key, clean(item)]),
    );
  }
  return value;
}

/** A API aceita até 20 ferramentas com `strict`. Quem não recebe nada não precisa dele. */
export const MAX_STRICT_TOOLS = 20;

/** Definição da ferramenta para a API. `executeTool` valida a entrada de todas com o zod. */
export function toApiTool(tool: AssistantTool) {
  const inputSchema = clean(z.toJSONSchema(tool.input)) as {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
  return {
    name: tool.name,
    description: tool.description,
    ...(Object.keys(inputSchema.properties).length > 0 ? { strict: true } : {}),
    input_schema: inputSchema,
  };
}
