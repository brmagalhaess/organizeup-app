import { z } from "zod";

/**
 * O schema `ops` não pode ter dados pessoais (AGENTS.md, regra 5). Barreira de melhor esforço:
 * pega os casos comuns, não substitui a regra dada aos agentes. `@example.com` é fictício.
 */
const PERSONAL_DATA = [
  {
    label: "e-mail",
    pattern: /[A-Z0-9._%+-]+@(?!example\.(com|org|net)\b)[A-Z0-9.-]+\.[A-Z]{2,}/i,
  },
  { label: "CPF", pattern: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/ },
  { label: "CNPJ", pattern: /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/ },
  { label: "telefone", pattern: /(?:\+55\s?)?\(?\b\d{2}\)?[\s-]?9\d{4}[\s-]?\d{4}\b/ },
  { label: "cartão", pattern: /\b(?:\d[ -]?){13,16}\b/ },
];

export function findPersonalData(text: string): string | null {
  return PERSONAL_DATA.find(({ pattern }) => pattern.test(text))?.label ?? null;
}

const slug = z.string().regex(/^[a-z0-9-]{1,40}$/, "Use o slug do agente.");
const free = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .superRefine((value, ctx) => {
      const found = findPersonalData(value);
      if (found) ctx.addIssue({ code: "custom", message: `Parece conter ${found}. Remova.` });
    });

export const memorySchema = z.object({
  agent: slug,
  kind: z.enum(["fato", "decisao", "licao", "preferencia"]),
  content: free(2000),
  sourceIssue: z.string().trim().max(40).optional(),
  supersedes: z.number().int().positive().optional(),
});

export const reportSchema = z.object({
  kind: z.enum(["saude", "semanal", "incidente", "custos", "produto"]),
  period: z.string().trim().min(1).max(40),
  agent: slug,
  title: free(200),
  body: free(20000),
});

/** Corpo JSON validado, ou a resposta de erro pronta. */
export async function parseBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ data: z.output<T> } | { error: Response }> {
  const raw: unknown = await request.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { data: parsed.data };
  const message = parsed.error.issues.map((issue) => issue.message).join("; ");
  return { error: Response.json({ error: message }, { status: 422 }) };
}
