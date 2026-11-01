import "server-only";
import { categoryNotificationSchema, notificationText } from "@organizeup/agents";
import {
  and,
  desc,
  eq,
  householdNotifications,
  householdSuggestions,
  isNotNull,
  isNull,
  sql,
  tolerateSchemaLag,
  withHousehold,
  type TenantContext,
} from "@organizeup/db";
import { agentText } from "@/i18n/agent-text";
import { resolveLocale } from "@/i18n/resolve";

/** A tela mostra as mais novas. Em uma família, 50 por noite é o teto, e o normal é bem menos. */
const MAX_ITEMS = 200;

export const NOTIFICATION_FILTERS = ["todas", "nao-lidas", "lidas"] as const;
export type NotificationFilter = (typeof NOTIFICATION_FILTERS)[number];

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  /** Falso: texto gravado em português, de uma linha que a tela não sabe ler. */
  translated: boolean;
  /** A categoria de destino nasceu com esta mudança: vira etiqueta ao lado do título. */
  isNew: boolean;
  href: string | null;
  createdAt: Date;
  read: boolean;
  /** `aplicada` deixa desfazer; `desfeita` já voltou. Null quando não há o que desfazer. */
  undo: "aplicada" | "desfeita" | null;
}

/** Contagem do sininho. A web pode subir antes do worker aplicar a migração: aí mostra zero. */
export async function countUnread(ctx: TenantContext): Promise<number> {
  return tolerateSchemaLag(
    () =>
      withHousehold(ctx, async (tx) => {
        const [row] = await tx
          .select({ total: sql<number>`count(*)::int` })
          .from(householdNotifications)
          .where(isNull(householdNotifications.readAt));
        return row?.total ?? 0;
      }),
    0,
  );
}

const filterOf = (filter: NotificationFilter) =>
  filter === "todas"
    ? undefined
    : filter === "lidas"
      ? isNotNull(householdNotifications.readAt)
      : isNull(householdNotifications.readAt);

/** Lista do mais novo ao mais antigo. Null enquanto a migração não chegou. */
export async function loadNotifications(
  ctx: TenantContext,
  filter: NotificationFilter,
): Promise<NotificationItem[] | null> {
  const locale = await resolveLocale();
  return tolerateSchemaLag<NotificationItem[] | null>(
    () =>
      withHousehold(ctx, async (tx) => {
        const rows = await tx
          .select({
            id: householdNotifications.id,
            title: householdNotifications.title,
            body: householdNotifications.body,
            href: householdNotifications.href,
            data: householdNotifications.data,
            messageKey: householdNotifications.messageKey,
            messageParams: householdNotifications.messageParams,
            createdAt: householdNotifications.createdAt,
            readAt: householdNotifications.readAt,
            status: householdSuggestions.status,
          })
          .from(householdNotifications)
          .leftJoin(
            householdSuggestions,
            and(
              eq(householdSuggestions.householdId, householdNotifications.householdId),
              eq(householdSuggestions.id, householdNotifications.suggestionId),
            ),
          )
          .where(filterOf(filter))
          .orderBy(desc(householdNotifications.createdAt), desc(householdNotifications.id))
          .limit(MAX_ITEMS);
        return rows.map((row): NotificationItem => {
          const parsed = categoryNotificationSchema.safeParse(row.data);
          // Linha de antes das chaves ainda tem `data`, de onde sai a mesma mensagem.
          const message = parsed.success ? notificationText(parsed.data).message : null;
          const text = agentText(
            {
              title: row.title,
              body: row.body,
              messageKey: row.messageKey ?? message?.key ?? null,
              messageParams: row.messageParams ?? message?.params ?? null,
            },
            locale,
          );
          return {
            id: row.id,
            ...text,
            isNew: parsed.success && parsed.data.type === "alteracao" && parsed.data.isNew,
            href: row.href,
            createdAt: row.createdAt,
            read: row.readAt !== null,
            undo: row.status === "aplicada" || row.status === "desfeita" ? row.status : null,
          };
        });
      }),
    null,
  );
}
