// Conversas. O RLS garante família e pessoa; aqui só se lê e grava em transações curtas.
import {
  and,
  asc,
  assistantMessages,
  assistantThreads,
  desc,
  eq,
  sql,
  withHousehold,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";

export type MessageStatus = "completa" | "parada" | "recusada" | "erro" | "limite";

export interface StoredMessage {
  text: string;
  /** O que o assistente olhou, para mostrar à família. */
  tools?: string[];
  status?: MessageStatus;
  /** Fala de investimento: mostra o aviso da CVM. */
  investment?: boolean;
  /** Algum valor da resposta não apareceu nas ferramentas nem na pergunta. */
  uncheckedNumbers?: boolean;
}

export interface ThreadMessage extends StoredMessage {
  id: string;
  role: "user" | "assistant";
}

const THREADS_SHOWN = 30;
const TITLE_MAX = 60;

const titleOf = (text: string) => {
  const line = text.trim().replace(/\s+/g, " ");
  return line.length <= TITLE_MAX ? line : `${line.slice(0, TITLE_MAX - 1).trimEnd()}…`;
};

function ownerOf(ctx: TenantContext): string {
  if (!ctx.userId) throw new Error("Conversa exige uma pessoa.");
  return ctx.userId;
}

export async function createThread(tx: TenantTx, ctx: TenantContext, firstMessage: string) {
  const [row] = await tx
    .insert(assistantThreads)
    .values({
      householdId: ctx.householdId,
      userId: ownerOf(ctx),
      title: titleOf(firstMessage) || "Conversa",
    })
    .returning({ id: assistantThreads.id });
  return row!.id;
}

export async function threadExists(tx: TenantTx, threadId: string): Promise<boolean> {
  const rows = await tx
    .select({ id: assistantThreads.id })
    .from(assistantThreads)
    .where(eq(assistantThreads.id, threadId));
  return rows.length > 0;
}

export async function appendMessage(
  tx: TenantTx,
  ctx: TenantContext,
  threadId: string,
  role: "user" | "assistant",
  content: StoredMessage,
) {
  await tx.insert(assistantMessages).values({
    householdId: ctx.householdId,
    userId: ownerOf(ctx),
    threadId,
    role,
    content: { ...content },
  });
  await tx
    .update(assistantThreads)
    .set({ updatedAt: sql`now()` })
    .where(eq(assistantThreads.id, threadId));
}

export async function threadMessages(tx: TenantTx, threadId: string): Promise<ThreadMessage[]> {
  const rows = await tx
    .select({
      id: assistantMessages.id,
      role: assistantMessages.role,
      content: assistantMessages.content,
    })
    .from(assistantMessages)
    .where(eq(assistantMessages.threadId, threadId))
    .orderBy(asc(assistantMessages.createdAt));
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    ...(row.content as unknown as StoredMessage),
  }));
}

export const listThreads = (ctx: TenantContext) =>
  withHousehold(ctx, (tx) =>
    tx
      .select({
        id: assistantThreads.id,
        title: assistantThreads.title,
        updatedAt: assistantThreads.updatedAt,
      })
      .from(assistantThreads)
      .orderBy(desc(assistantThreads.updatedAt))
      .limit(THREADS_SHOWN),
  );

/** Null quando a conversa não existe ou não é desta pessoa. */
export const loadThread = (ctx: TenantContext, threadId: string) =>
  withHousehold(ctx, async (tx) =>
    (await threadExists(tx, threadId)) ? threadMessages(tx, threadId) : null,
  );

export async function deleteThread(ctx: TenantContext, threadId: string): Promise<boolean> {
  const rows = await withHousehold(ctx, (tx) =>
    tx
      .delete(assistantThreads)
      .where(
        and(eq(assistantThreads.id, threadId), eq(assistantThreads.householdId, ctx.householdId)),
      )
      .returning({ id: assistantThreads.id }),
  );
  return rows.length > 0;
}
