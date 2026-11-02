// Planos e assinatura (ADR-0023). O acesso sai daqui, da tabela local, sem chamar a Stripe a cada tela.
// `readFamilyAccess` é a leitura única de web, worker e assistente; a regra é `resolveAccess`, do domínio.
import {
  canUseCurrency,
  resolveAccess,
  todayIn,
  yearMonthOf,
  type BillingCycle,
  type CatalogPrice,
  type Currency,
  type FamilyAccess,
  type SubscriptionState,
} from "@organizeup/domain";
import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { readPlatformFlags, tolerateSchemaLag, type PlatformFlags } from "./access";
import { appPool } from "./client";
import { accountCurrency, householdCurrency } from "./fx";
import {
  billingCatalog,
  billingCheckouts,
  billingEvents,
  cardPurchaseUsage,
  householdSubscriptions,
  householdUsage,
  transactionUsage,
} from "./schema";
import { fromJob, withHousehold, type TenantContext, type TenantTx } from "./tenant";
import { householdTimezone } from "./wealth";

export type HouseholdSubscription = typeof householdSubscriptions.$inferSelect;

/** Preços à venda. Sem a tabela ainda, a tela de planos abre sem preços e diz isso. */
export async function readBillingCatalog(): Promise<CatalogPrice[]> {
  return tolerateSchemaLag(async () => {
    const rows = await appPool()
      .db.select({
        id: billingCatalog.id,
        item: billingCatalog.item,
        cycle: billingCatalog.cycle,
        amount: billingCatalog.amount,
        stripePriceId: billingCatalog.stripePriceId,
      })
      .from(billingCatalog)
      .where(eq(billingCatalog.onSale, true))
      .orderBy(asc(billingCatalog.item));
    return rows;
  }, []);
}

/** Por qual item e ciclo cada preço foi vendido, inclusive os que saíram de venda. */
export async function priceBook(): Promise<
  Map<string, { item: string; amount: string; cycle: BillingCycle }>
> {
  const rows = await appPool()
    .db.select({
      price: billingCatalog.stripePriceId,
      item: billingCatalog.item,
      amount: billingCatalog.amount,
      cycle: billingCatalog.cycle,
    })
    .from(billingCatalog);
  return new Map(
    rows.flatMap((row) =>
      row.price ? [[row.price, { item: row.item, amount: row.amount, cycle: row.cycle }]] : [],
    ),
  );
}

export async function readSubscription(ctx: TenantContext): Promise<HouseholdSubscription | null> {
  return tolerateSchemaLag(async () => {
    const [row] = await withHousehold(ctx, (tx) =>
      tx
        .select()
        .from(householdSubscriptions)
        .where(eq(householdSubscriptions.householdId, ctx.householdId)),
    );
    return row ?? null;
  }, null);
}

export const subscriptionState = (row: HouseholdSubscription): SubscriptionState => ({
  courtesy: row.courtesy,
  courtesyUntil: row.courtesyUntil,
  trialEndsAt: row.trialEndsAt,
  status: row.status,
  items: row.items,
  cancelAtPeriodEnd: row.cancelAtPeriodEnd,
  currentPeriodEnd: row.currentPeriodEnd,
});

/**
 * O que a família pode agora. Com a chave desligada nem lê a assinatura: todos como hoje. `flags` evita
 * reler as chaves quando quem chama já as tem, como a rodada dos agentes.
 */
export async function readFamilyAccess(
  ctx: TenantContext,
  flags?: Pick<PlatformFlags, "billingEnabled">,
  now: Date = new Date(),
): Promise<FamilyAccess> {
  const { billingEnabled } = flags ?? (await readPlatformFlags());
  if (!billingEnabled) return resolveAccess({ billingEnabled, subscription: null, now });
  const row = await readSubscription(ctx);
  return resolveAccess({
    billingEnabled,
    subscription: row ? subscriptionState(row) : null,
    now,
  });
}

/** Mês de contagem: o do fuso da família. */
export const usageMonthOf = async (tx: TenantTx, householdId: string, now: Date = new Date()) =>
  yearMonthOf(todayIn(await householdTimezone(tx, householdId), now));

/**
 * Segura as gravações da família até o fim da transação. Sem isso, duas gravações no limite contariam
 * o mesmo total e passariam juntas.
 */
export async function lockEntryQuota(tx: TenantTx, householdId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`cota:${householdId}`}, 0))`,
  );
}

/** O que conta para o limite: só o que foi marcado com `usage_month`, ver a migração 0036. */
export async function countEntries(tx: TenantTx, month: string): Promise<number> {
  const [row] = await tx.execute<{ n: number }>(sql`
    select (
      (select count(*) from ${transactionUsage} where ${transactionUsage.usageMonth} = ${month})
      + (select count(*) from ${cardPurchaseUsage} where ${cardPurchaseUsage.usageMonth} = ${month})
    )::int as n`);
  return row?.n ?? 0;
}

/** Moeda adicional cancelada: a conta fica e o histórico também, mas nada novo grava nela. */
export async function currencyFrozen(tx: TenantTx, currency: Currency): Promise<boolean> {
  const main = await householdCurrency(tx);
  if (currency === main) return false;
  return !canUseCurrency(await accessWithin(tx), currency, main);
}

export async function accountCurrencyFrozen(tx: TenantTx, accountId: string): Promise<boolean> {
  const currency = await accountCurrency(tx, accountId);
  return currency ? currencyFrozen(tx, currency) : false;
}

/** `month` null: chave desligada, e nada é marcado. É o que deixa a web subir antes da migração. */
export type EntryQuota =
  { ok: true; month: string | null } | { ok: false; month: string; left: number };

/**
 * Reserva `count` lançamentos. Devolve o mês para gravar em `usage_month`. A trava vale até o fim da
 * transação, então quem chama precisa gravar nela. Sem limite não trava: não há o que disputar.
 */
export async function takeEntries(
  tx: TenantTx,
  access: Pick<FamilyAccess, "entryLimit"> & Partial<Pick<FamilyAccess, "mode">>,
  householdId: string,
  count: number,
): Promise<EntryQuota> {
  if (access.mode === "livre") return { ok: true, month: null };
  const month = await usageMonthOf(tx, householdId);
  const limit = access.entryLimit;
  if (limit === null) return { ok: true, month };
  await lockEntryQuota(tx, householdId);
  const used = await countEntries(tx, month);
  return used + count <= limit
    ? { ok: true, month }
    : { ok: false, month, left: Math.max(limit - used, 0) };
}

/** Marca os lançamentos que contam para o limite. Sem mês, nada a marcar. */
export async function markEntries(
  tx: TenantTx,
  month: string | null,
  ids: string[],
): Promise<void> {
  if (!month || ids.length === 0) return;
  await tx
    .update(transactionUsage)
    .set({ usageMonth: month })
    .where(inArray(transactionUsage.id, ids));
}

/** Uma compra conta uma vez, com ou sem parcelas. */
export async function markCardPurchase(
  tx: TenantTx,
  month: string | null,
  id: string,
): Promise<void> {
  if (!month) return;
  await tx.update(cardPurchaseUsage).set({ usageMonth: month }).where(eq(cardPurchaseUsage.id, id));
}

/** Plano da família dentro de uma transação já aberta, sem pedir outra conexão. */
export async function accessWithin(tx: TenantTx): Promise<FamilyAccess> {
  const { billingEnabled } = await readPlatformFlags();
  const now = new Date();
  if (!billingEnabled) return resolveAccess({ billingEnabled, subscription: null, now });
  const [row] = await tx.select().from(householdSubscriptions);
  return resolveAccess({
    billingEnabled,
    subscription: row ? subscriptionState(row) : null,
    now,
  });
}

/** Assinaturas que ainda cobram nestas famílias: precisam parar na Stripe antes de apagar. */
export async function liveSubscriptionIds(householdIds: string[]): Promise<string[]> {
  const rows = await Promise.all(
    householdIds.map((householdId) => readSubscription(fromJob({ householdId }))),
  );
  return rows.flatMap((row) =>
    row?.stripeSubscriptionId && !["canceled", "incomplete_expired"].includes(row.status ?? "")
      ? [row.stripeSubscriptionId]
      : [],
  );
}

const CHECKOUT_LOCK_SECONDS = 60;

export type BillingCheckout = typeof billingCheckouts.$inferSelect;

/**
 * Pega a trava de pagamento da família. Null: outro pedido está abrindo o pagamento agora. Vale por um
 * minuto, para uma queda no meio não prender a família.
 */
export async function claimBillingCheckout(householdId: string): Promise<BillingCheckout | null> {
  const lockedUntil = new Date(Date.now() + CHECKOUT_LOCK_SECONDS * 1000);
  const [row] = await appPool()
    .db.insert(billingCheckouts)
    .values({ householdId, lockedUntil })
    .onConflictDoUpdate({
      target: billingCheckouts.householdId,
      set: { lockedUntil, updatedAt: new Date() },
      setWhere: lt(billingCheckouts.lockedUntil, sql`now()`),
    })
    .returning();
  return row ?? null;
}

export async function saveBillingCheckout(
  householdId: string,
  values: { customerId?: string; sessionId?: string },
): Promise<void> {
  await appPool()
    .db.update(billingCheckouts)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(billingCheckouts.householdId, householdId));
}

export async function releaseBillingCheckout(householdId: string): Promise<void> {
  await appPool()
    .db.update(billingCheckouts)
    .set({ lockedUntil: new Date(0) })
    .where(eq(billingCheckouts.householdId, householdId));
}

export interface MonthUsage {
  month: string;
  entries: number;
  messages: number;
}

/** Quanto a família usou no mês. Sem as colunas ainda, zero: uso não derruba tela. */
export async function readMonthUsage(ctx: TenantContext): Promise<MonthUsage | null> {
  return tolerateSchemaLag(
    () =>
      withHousehold(ctx, async (tx) => {
        const month = await usageMonthOf(tx, ctx.householdId);
        const [row] = await tx
          .select({ messages: householdUsage.messages })
          .from(householdUsage)
          .where(
            and(eq(householdUsage.householdId, ctx.householdId), eq(householdUsage.month, month)),
          );
        return { month, entries: await countEntries(tx, month), messages: row?.messages ?? 0 };
      }),
    null,
  );
}

/**
 * Gasta uma mensagem, numa instrução só: a linha trava, e a segunda conversa no limite não passa. Sem
 * vaga, nada é gravado e devolve false.
 */
export async function takeMessage(
  tx: TenantTx,
  householdId: string,
  month: string,
  limit: number | null,
): Promise<boolean> {
  if (limit !== null && limit <= 0) return false;
  const rows = await tx
    .insert(householdUsage)
    .values({ householdId, month, messages: 1 })
    .onConflictDoUpdate({
      target: [householdUsage.householdId, householdUsage.month],
      set: { messages: sql`${householdUsage.messages} + 1`, updatedAt: new Date() },
      ...(limit === null ? {} : { setWhere: sql`${householdUsage.messages} < ${limit}` }),
    })
    .returning({ messages: householdUsage.messages });
  return rows.length > 0;
}

/** Devolve a mensagem de uma pergunta que não teve resposta porque a chamada falhou. */
export async function giveBackMessage(
  tx: TenantTx,
  householdId: string,
  month: string,
): Promise<void> {
  await tx
    .update(householdUsage)
    .set({ messages: sql`greatest(${householdUsage.messages} - 1, 0)`, updatedAt: new Date() })
    .where(and(eq(householdUsage.householdId, householdId), eq(householdUsage.month, month)));
}

export interface BillingEventInput {
  id: string;
  type: string;
  stripeAt: Date;
  livemode: boolean;
  householdId: string | null;
  customerId: string | null;
  data: Record<string, unknown>;
}

/** Guarda o evento uma vez só. False: esse id já chegou, e a Stripe só está repetindo. */
export async function recordBillingEvent(event: BillingEventInput): Promise<boolean> {
  const rows = await appPool()
    .db.insert(billingEvents)
    .values(event)
    .onConflictDoNothing({ target: billingEvents.id })
    .returning({ id: billingEvents.id });
  return rows.length > 0;
}

export type StoredBillingEvent = typeof billingEvents.$inferSelect;

/** Por ordem de quando aconteceram na Stripe, e não de quando chegaram. */
export async function pendingBillingEvents(limit = 200): Promise<StoredBillingEvent[]> {
  return appPool()
    .db.select()
    .from(billingEvents)
    .where(isNull(billingEvents.processedAt))
    .orderBy(asc(billingEvents.stripeAt), asc(billingEvents.id))
    .limit(limit);
}

/** Família de um cliente da Stripe, pelo que eventos anteriores trouxeram. Reembolso não traz metadata. */
export async function householdOfCustomer(customerId: string): Promise<string | null> {
  const [row] = await appPool()
    .db.select({ householdId: billingEvents.householdId })
    .from(billingEvents)
    .where(
      and(eq(billingEvents.customerId, customerId), sql`${billingEvents.householdId} is not null`),
    )
    .limit(1);
  return row?.householdId ?? null;
}

export async function finishBillingEvent(id: string): Promise<void> {
  await appPool()
    .db.update(billingEvents)
    .set({
      processedAt: new Date(),
      attempts: sql`${billingEvents.attempts} + 1`,
      errorCode: null,
    })
    .where(eq(billingEvents.id, id));
}

/** Fica pendente para a próxima passada. `give_up` fecha o evento sem aplicar, com o motivo guardado. */
export async function retryBillingEvent(id: string, code: string, giveUp = false): Promise<void> {
  await appPool()
    .db.update(billingEvents)
    .set({
      attempts: sql`${billingEvents.attempts} + 1`,
      errorCode: code,
      ...(giveUp ? { processedAt: new Date() } : {}),
    })
    .where(eq(billingEvents.id, id));
}
