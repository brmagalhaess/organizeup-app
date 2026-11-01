// Central de notificações (decisão do fundador em 2026-11-01, ADR-0015): o que o agente mudou sozinho,
// com o antes e o depois. O texto da tela nasce de `data`, em cada idioma; `title` e `body` são a mesma
// coisa em português. Uma linha por estabelecimento e destino a cada noite, até o limite, e o resto
// numa linha de resumo. Tudo roda dentro do `tx` recebido.
import { eq, householdNotifications, sql, type TenantTx } from "@organizeup/db";
import { formatBRL, money, toDbAmount } from "@organizeup/domain";
import { z } from "zod";
import { clamp, plural } from "./shared";
import { kindSchema, nonNegativeAmountSchema } from "./suggestions";

/** Linhas por noite. O resto vai para o resumo, e continua em Sugestões com Desfazer. */
export const MAX_NIGHT_NOTIFICATIONS = 50;

const MAX_TITLE = 160;
const MAX_BODY = 800;
const SUGGESTIONS_HREF = "/app/sugestoes";

const categoryChangeSchema = z.object({
  type: z.literal("alteracao"),
  /** Estabelecimento, pela chave da memória. */
  merchant: z.string().min(1),
  kind: kindSchema,
  count: z.number().int().min(1),
  /** Soma em reais: `transactions.amount` é sempre em reais (ADR-0020). */
  total: nonNegativeAmountSchema,
  /** Categorias de antes, da mais comum para a menos comum. */
  fromNames: z.array(z.string().min(1)).min(1),
  toName: z.string().min(1),
  /** A categoria de destino nasceu com esta mudança. */
  isNew: z.boolean(),
});

const categoryMergeSchema = z.object({
  type: z.literal("fusao"),
  count: z.number().int().min(0),
  total: nonNegativeAmountSchema,
  fromNames: z.array(z.string().min(1)).min(1),
  toName: z.string().min(1),
});

const categorySummarySchema = z.object({
  type: z.literal("resumo"),
  /** Mudanças que passaram do limite da noite. */
  changes: z.number().int().min(1),
  count: z.number().int().min(0),
  total: nonNegativeAmountSchema,
});

export const categoryNotificationSchema = z.discriminatedUnion("type", [
  categoryChangeSchema,
  categoryMergeSchema,
  categorySummarySchema,
]);

export type CategoryChangeLine = z.infer<typeof categoryChangeSchema>;
export type CategoryMergeLine = z.infer<typeof categoryMergeSchema>;
export type CategorySummaryLine = z.infer<typeof categorySummarySchema>;
export type CategoryNotification = z.infer<typeof categoryNotificationSchema>;

const entries = (count: number) => plural(count, "lançamento", "lançamentos");

function textOf(data: CategoryNotification): { title: string; body: string } {
  const sum = formatBRL(data.total);
  if (data.type === "resumo")
    return {
      title: `E mais ${plural(data.changes, "mudança", "mudanças")} nesta noite`,
      body: `${entries(data.count)}, ${sum}. Tudo está em Sugestões, com Desfazer.`,
    };
  const title = `De ${data.fromNames.join(", ")} para ${data.toName}`;
  if (data.type === "fusao")
    return { title, body: `Categorias juntadas: ${entries(data.count)}, ${sum}.` };
  const fresh = data.isNew ? " Categoria nova." : "";
  return { title, body: `${data.merchant}: ${entries(data.count)}, ${sum}.${fresh}` };
}

const added = (a: string, b: string) => toDbAmount(money(a).plus(b));

/** Soma ao que a noite já avisou sobre o mesmo estabelecimento e destino. */
function mergedLine(saved: unknown, line: CategoryChangeLine | CategoryMergeLine) {
  const parsed = categoryNotificationSchema.safeParse(saved);
  if (!parsed.success || parsed.data.type !== line.type) return line;
  const previous = parsed.data as typeof line;
  return {
    ...line,
    ...("isNew" in previous && "isNew" in line ? { isNew: previous.isNew || line.isNew } : {}),
    count: previous.count + line.count,
    total: added(previous.total, line.total),
    fromNames: [...new Set([...previous.fromNames, ...line.fromNames])],
  } as typeof line;
}

async function addToSummary(
  tx: TenantTx,
  scope: NotificationScope,
  line: { count: number; total: string },
  merged: boolean,
): Promise<void> {
  const dedupeKey = `categoria-resumo:${scope.today}`;
  const [saved] = await tx
    .select({ id: householdNotifications.id, data: householdNotifications.data })
    .from(householdNotifications)
    .where(eq(householdNotifications.dedupeKey, dedupeKey));
  const parsed = categorySummarySchema.safeParse(saved?.data);
  const data: CategorySummaryLine = parsed.success
    ? {
        type: "resumo",
        changes: parsed.data.changes + (merged ? 0 : 1),
        count: parsed.data.count + line.count,
        total: added(parsed.data.total, line.total),
      }
    : { type: "resumo", changes: 1, count: line.count, total: line.total };
  const text = textOf(data);
  const values = {
    title: clamp(text.title, MAX_TITLE),
    body: clamp(text.body, MAX_BODY),
    data,
  };
  if (saved) {
    await tx
      .update(householdNotifications)
      .set({ ...values, readAt: null })
      .where(eq(householdNotifications.id, saved.id));
    return;
  }
  await tx.insert(householdNotifications).values({
    ...values,
    householdId: scope.householdId,
    kind: "categoria",
    href: SUGGESTIONS_HREF,
    dedupeKey,
  });
}

export interface NotificationScope {
  householdId: string;
  /** Data civil de hoje no fuso da família (AAAA-MM-DD). */
  today: string;
}

export interface CategoryNotice {
  suggestionId: string;
  /** `dedupe_key` da sugestão: estabelecimento e destino, ou o par da fusão. */
  key: string;
  line: CategoryChangeLine | CategoryMergeLine;
  /** A mudança entrou numa sugestão que já existia hoje. */
  merged: boolean;
}

/**
 * Avisa uma mudança. A mesma chave no mesmo dia soma na linha que já existe: é isso que deixa a rodada
 * repetir sem repetir o aviso. Soma nova volta a ficar não lida, porque a família ainda não a viu.
 */
export async function notifyCategoryChange(
  tx: TenantTx,
  scope: NotificationScope,
  notice: CategoryNotice,
): Promise<void> {
  const prefix = `categoria:${scope.today}:`;
  const dedupeKey = `${prefix}${notice.key}`.slice(0, 200);
  const [saved] = await tx
    .select({ id: householdNotifications.id, data: householdNotifications.data })
    .from(householdNotifications)
    .where(eq(householdNotifications.dedupeKey, dedupeKey));
  if (saved) {
    const data = mergedLine(saved.data, notice.line);
    const text = textOf(data);
    await tx
      .update(householdNotifications)
      .set({
        title: clamp(text.title, MAX_TITLE),
        body: clamp(text.body, MAX_BODY),
        data,
        readAt: null,
      })
      .where(eq(householdNotifications.id, saved.id));
    return;
  }

  const [night] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(householdNotifications)
    .where(sql`${householdNotifications.dedupeKey} like ${`${prefix}%`}`);
  if ((night?.total ?? 0) >= MAX_NIGHT_NOTIFICATIONS) {
    await addToSummary(tx, scope, notice.line, notice.merged);
    return;
  }
  const text = textOf(notice.line);
  await tx.insert(householdNotifications).values({
    householdId: scope.householdId,
    kind: "categoria",
    title: clamp(text.title, MAX_TITLE),
    body: clamp(text.body, MAX_BODY),
    data: notice.line,
    suggestionId: notice.suggestionId,
    dedupeKey,
  });
}
