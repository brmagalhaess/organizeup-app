"use server";
import { and, canWrite, eq, householdInsights, withHousehold } from "@organizeup/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/session";

const id = z.uuid();

/** "Entendi" e "Fazer agora" tiram a dica da tela. Ela não volta por 30 dias. */
export async function decideInsight(insightId: string, status: "feita" | "dispensada") {
  const { ctx } = await requireTenant();
  const parsed = id.safeParse(insightId);
  if (!parsed.success || !canWrite(ctx)) return;
  await withHousehold(ctx, (tx) =>
    tx
      .update(householdInsights)
      .set({ status, decidedAt: new Date(), decidedBy: ctx.userId })
      .where(and(eq(householdInsights.id, parsed.data), eq(householdInsights.status, "ativa"))),
  );
  revalidatePath("/app", "layout");
}
