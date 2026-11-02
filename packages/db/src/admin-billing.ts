// Painel de planos (ADR-0025, spec, seção 9). Mesma regra de `admin.ts`: leitura pelo pool somente leitura, e ação
// com o registro em ops.admin_access na mesma transação. O registro só entra quando a ação aconteceu: recusa não
// aparece na auditoria como se tivesse sido feita. Nada aqui lê valor, lançamento nem texto de família: o que sai
// é o que a família paga ao serviço, contagens, datas e códigos. Ids da Stripe só saem por `adminStripeTarget`.
import {
  CONNECTED_ITEM,
  money,
  resolveAccess,
  vipActive,
  vipEndingSoon,
  willChargeAgain,
  type BillingCycle,
  type BillingModule,
  type Currency,
  type FamilyAccess,
  type ReportKind,
  type VipCost,
  type VipReason,
  type VipScope,
} from "@organizeup/domain";
import { and, count, desc, eq, gte, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { tolerateSchemaLag } from "./access";
import { withAdmin, withAdminRead, type AdminActor } from "./admin";
import {
  priceBook,
  subscriptionState,
  vipState,
  type HouseholdSubscription,
  type VipGrant,
} from "./billing";
import type { Db } from "./client";
import {
  adminAccess,
  aiUsage,
  billingCatalog,
  billingEvents,
  household,
  householdMember,
  householdNotifications,
  householdReports,
  householdSettings,
  householdStatements,
  householdSubscriptions,
  marketFx,
  vipGrants,
} from "./schema";

type AdminTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Reader = Pick<Db, "select">;

const act = <T>(action: string, fn: (tx: AdminTx) => Promise<T>) =>
  withAdmin(`painel admin: ${action}`, (db) => db.transaction(fn));

/** Entra na transação da ação, depois de ela ter acontecido. */
const audit = async (
  tx: AdminTx,
  admin: AdminActor,
  action: string,
  target: { householdId?: string | null | undefined; userId?: string | null | undefined } = {},
) => {
  await tx.insert(adminAccess).values({
    adminUserId: admin.adminUserId,
    action,
    targetHouseholdId: target.householdId ?? null,
    targetUserId: target.userId ?? null,
  });
};

const familyExists = async (db: Reader, id: string) => {
  const [row] = await db.select({ id: household.id }).from(household).where(eq(household.id, id));
  return Boolean(row);
};

/** Ninguém do painel age sobre a família de que participa (ADR-0016). */
const isMember = async (db: Reader, userId: string, householdId: string) => {
  const [row] = await db
    .select({ id: householdMember.id })
    .from(householdMember)
    .where(and(eq(householdMember.userId, userId), eq(householdMember.organizationId, householdId)))
    .limit(1);
  return Boolean(row);
};

const isOwner = async (db: Reader, userId: string, householdId: string) => {
  const [row] = await db
    .select({ id: householdMember.id })
    .from(householdMember)
    .where(
      and(
        eq(householdMember.userId, userId),
        eq(householdMember.organizationId, householdId),
        eq(householdMember.role, "owner"),
      ),
    )
    .limit(1);
  return Boolean(row);
};

// ---------- Situação por família ----------

/** A linha da assinatura, sem nenhum id da Stripe. */
export type AdminSubscription = Omit<
  HouseholdSubscription,
  "stripeCustomerId" | "stripeSubscriptionId" | "stripeScheduleId" | "scheduleEndedId"
> & { hasSubscription: boolean; hasCustomer: boolean };

export interface AdminVipGrant {
  grant: VipGrant;
  holderActive: boolean;
}

export interface AdminFamilyBilling {
  householdId: string;
  name: string;
  createdAt: Date;
  /** Null: família sem linha, o que só um erro nosso causa. */
  subscription: AdminSubscription | null;
  /** Concessão aberta, mesmo vencida: quem decide se vale é `resolveAccess`. */
  vip: AdminVipGrant | null;
}

function safeSubscription(row: HouseholdSubscription): AdminSubscription {
  const { stripeCustomerId, stripeSubscriptionId, stripeScheduleId, scheduleEndedId, ...rest } =
    row;
  void stripeScheduleId;
  void scheduleEndedId;
  return {
    ...rest,
    hasSubscription: Boolean(stripeSubscriptionId),
    hasCustomer: Boolean(stripeCustomerId),
  };
}

/** A pessoa ainda é responsável pela família da concessão? De família, sempre. */
const holderActive = (db: Reader) =>
  sql<boolean>`(${vipGrants.scope} = 'familia' or exists (${db
    .select({ one: sql`1` })
    .from(householdMember)
    .where(
      and(
        eq(householdMember.organizationId, vipGrants.householdId),
        eq(householdMember.userId, vipGrants.userId),
        eq(householdMember.role, "owner"),
      ),
    )}))`;

async function loadFamilies(db: Db, id?: string): Promise<AdminFamilyBilling[]> {
  const only = id ? eq(household.id, id) : undefined;
  const [families, grants] = await Promise.all([
    db
      .select({
        householdId: household.id,
        name: household.name,
        createdAt: household.createdAt,
        subscription: householdSubscriptions,
      })
      .from(household)
      .leftJoin(householdSubscriptions, eq(householdSubscriptions.householdId, household.id))
      .where(only)
      .orderBy(desc(household.createdAt)),
    db
      .select({ grant: vipGrants, holderActive: holderActive(db) })
      .from(vipGrants)
      .where(and(isNull(vipGrants.revokedAt), id ? eq(vipGrants.householdId, id) : undefined)),
  ]);
  const open = new Map(grants.map((row) => [row.grant.householdId, row]));
  return families.map((family) => ({
    ...family,
    subscription: family.subscription ? safeSubscription(family.subscription) : null,
    vip: open.get(family.householdId) ?? null,
  }));
}

/** Todas as famílias com a situação de cobrança, sem id da Stripe. Vazio até a migração chegar. */
export function adminBillingFamilies(): Promise<AdminFamilyBilling[]> {
  return tolerateSchemaLag(() => withAdminRead("painel admin: assinaturas", loadFamilies), []);
}

export function adminBillingFamily(id: string): Promise<AdminFamilyBilling | null> {
  return tolerateSchemaLag(
    () =>
      withAdminRead("painel admin: assinatura da família", async (db) => {
        const [row] = await loadFamilies(db, id);
        return row ?? null;
      }),
    null,
  );
}

/**
 * O que vale para a família **com a chave ligada**, pela mesma regra de todo o sistema. Com a chave desligada
 * todos estão em `livre`, e o painel precisa mostrar o que passa a valer ao ligar.
 */
export const adminFamilyAccess = (family: AdminFamilyBilling, now: Date): FamilyAccess =>
  resolveAccess({
    billingEnabled: true,
    subscription: family.subscription ? subscriptionState(family.subscription) : null,
    vip: family.vip ? vipState(family.vip.grant, family.vip.holderActive) : null,
    now,
  });

/** Ids da Stripe de UMA família, para a action chamar o gateway. Nunca vão para a tela. */
export function adminStripeTarget(householdId: string) {
  return withAdminRead("painel admin: alvo da Stripe", async (db) => {
    const [row] = await db
      .select({
        subscriptionId: householdSubscriptions.stripeSubscriptionId,
        customerId: householdSubscriptions.stripeCustomerId,
        scheduleId: householdSubscriptions.stripeScheduleId,
        status: householdSubscriptions.status,
        cancelAtPeriodEnd: householdSubscriptions.cancelAtPeriodEnd,
        firstPaidAt: householdSubscriptions.firstPaidAt,
        refundedAt: householdSubscriptions.refundedAt,
        discountPercent: householdSubscriptions.discountPercent,
      })
      .from(householdSubscriptions)
      .where(eq(householdSubscriptions.householdId, householdId));
    return row ?? null;
  });
}

export interface AdminBillingEvent {
  key: string;
  at: Date;
  type: string;
  /** Situação da Stripe, quando o evento traz. */
  status: string | null;
  /** Itens do catálogo, quando o evento traz. */
  items: string[];
  /** Valor pago em centavos, na fatura. */
  amountPaidCents: number | null;
  errorCode: string | null;
}

/** Histórico de trocas de UMA família, pelos eventos guardados. Só situação, itens e valor cobrado. */
export function adminBillingHistory(householdId: string, limit = 30): Promise<AdminBillingEvent[]> {
  return tolerateSchemaLag(
    () =>
      withAdminRead("painel admin: histórico da assinatura", async (db) => {
        const [sub] = await db
          .select({ customerId: householdSubscriptions.stripeCustomerId })
          .from(householdSubscriptions)
          .where(eq(householdSubscriptions.householdId, householdId));
        const rows = await db
          .select({
            key: billingEvents.id,
            at: billingEvents.stripeAt,
            type: billingEvents.type,
            data: billingEvents.data,
            errorCode: billingEvents.errorCode,
          })
          .from(billingEvents)
          .where(
            or(
              eq(billingEvents.householdId, householdId),
              // Devolução não traz a família, só o cliente.
              sub?.customerId ? eq(billingEvents.customerId, sub.customerId) : undefined,
            ),
          )
          .orderBy(desc(billingEvents.stripeAt))
          .limit(limit);
        const book = await priceBook();
        return rows.map(({ data, ...row }) => {
          const lines = Array.isArray(data.items) ? (data.items as Array<{ price: string }>) : [];
          return {
            ...row,
            status: typeof data.status === "string" ? data.status : null,
            items: lines.map((line) => book.get(line.price)?.item ?? "desconhecido"),
            amountPaidCents: typeof data.amountPaid === "number" ? data.amountPaid : null,
          };
        });
      }),
    [],
  );
}

// ---------- VIP ----------

export interface VipGrantInput {
  householdId: string;
  scope: VipScope;
  /** Só em VIP de pessoa: ela precisa ser responsável pela família. */
  userId: string | null;
  full: boolean;
  modules: BillingModule[];
  entryLimit: number | null;
  messageLimit: number | null;
  currencies: Currency[];
  cost: VipCost;
  discountPercent: number | null;
  reason: VipReason;
  endsAt: Date | null;
}

export type VipGrantResult =
  | "ok"
  | "not_found"
  | "own_family"
  /** Já há concessão aberta nesta família. */
  | "ja_vip"
  /** A pessoa não é responsável por esta família. */
  | "nao_responsavel"
  /** Sem custo, e a Stripe segue cobrando: cancele antes. */
  | "assinatura_viva";

/**
 * Concede VIP. Só o índice parcial decide quem ganha entre dois pedidos ao mesmo tempo. A concessão aberta que
 * já venceu é fechada antes, na mesma transação, porque ela não vale mais e não pode segurar a nova.
 */
export function adminGrantVip(admin: AdminActor, input: VipGrantInput): Promise<VipGrantResult> {
  const { householdId, userId, scope } = input;
  return act("vip:conceder", async (tx): Promise<VipGrantResult> => {
    if (!(await familyExists(tx, householdId))) return "not_found";
    if (await isMember(tx, admin.adminUserId, householdId)) return "own_family";
    if (scope === "pessoa" && !(userId && (await isOwner(tx, userId, householdId)))) {
      return "nao_responsavel";
    }
    if (input.cost === "sem_custo") {
      const [sub] = await tx
        .select({
          status: householdSubscriptions.status,
          cancelAtPeriodEnd: householdSubscriptions.cancelAtPeriodEnd,
        })
        .from(householdSubscriptions)
        .where(eq(householdSubscriptions.householdId, householdId));
      if (sub && willChargeAgain(sub)) return "assinatura_viva";
    }
    const now = new Date();
    await tx
      .update(vipGrants)
      .set({ revokedAt: now, revokedBy: "validade" })
      .where(
        and(
          eq(vipGrants.householdId, householdId),
          isNull(vipGrants.revokedAt),
          lte(vipGrants.endsAt, now),
        ),
      );
    const rows = await tx
      .insert(vipGrants)
      .values({
        householdId,
        scope,
        userId: scope === "pessoa" ? userId : null,
        fullAccess: input.full,
        modules: input.full ? [] : input.modules,
        entryLimit: input.full ? null : input.entryLimit,
        messageLimit: input.full ? null : input.messageLimit,
        currencies: input.full ? [] : input.currencies,
        cost: input.cost,
        discountPercent: input.cost === "desconto" ? input.discountPercent : null,
        reason: input.reason,
        endsAt: input.endsAt,
        grantedBy: admin.adminUserId,
      })
      .onConflictDoNothing({
        target: vipGrants.householdId,
        where: sql`revoked_at is null`,
      })
      .returning({ id: vipGrants.id });
    if (rows.length === 0) return "ja_vip";
    await audit(tx, admin, "vip:conceder", {
      householdId,
      userId: scope === "pessoa" ? userId : null,
    });
    return "ok";
  });
}

/** Remove: a linha fica, com quem e quando. Não mexe em desconto na Stripe: isso é uma ação à parte. */
export function adminRevokeVip(admin: AdminActor, id: string): Promise<"ok" | "not_found"> {
  return act("vip:remover", async (tx) => {
    const [row] = await tx
      .update(vipGrants)
      .set({ revokedAt: new Date(), revokedBy: admin.adminUserId })
      .where(and(eq(vipGrants.id, id), isNull(vipGrants.revokedAt)))
      .returning({ householdId: vipGrants.householdId, userId: vipGrants.userId });
    if (!row) return "not_found";
    await audit(tx, admin, "vip:remover", row);
    return "ok";
  });
}

/** Muda a validade de uma concessão aberta. Null: sem data. */
export function adminExtendVip(
  admin: AdminActor,
  id: string,
  endsAt: Date | null,
): Promise<"ok" | "not_found" | "own_family"> {
  return act("vip:validade", async (tx) => {
    const [row] = await tx
      .select({ householdId: vipGrants.householdId, userId: vipGrants.userId })
      .from(vipGrants)
      .where(and(eq(vipGrants.id, id), isNull(vipGrants.revokedAt)))
      .for("update");
    if (!row) return "not_found";
    if (await isMember(tx, admin.adminUserId, row.householdId)) return "own_family";
    await tx.update(vipGrants).set({ endsAt }).where(eq(vipGrants.id, id));
    await audit(tx, admin, "vip:validade", row);
    return "ok";
  });
}

export type VipStatus = "ativo" | "vencendo" | "vencido" | "removido" | "sem_responsavel";

export interface AdminVipRow {
  grant: VipGrant;
  familyName: string;
  status: VipStatus;
  /** Sem custo, e a Stripe segue cobrando: um webhook chegou depois da concessão. */
  stillCharged: boolean;
  /** Desconto em vigor na Stripe. */
  stripeDiscount: number | null;
}

function vipStatusOf(row: AdminVipGrant, now: Date): VipStatus {
  const state = vipState(row.grant, row.holderActive);
  if (row.grant.revokedAt) return "removido";
  if (!row.holderActive) return "sem_responsavel";
  if (!vipActive(state, now)) return "vencido";
  return vipEndingSoon(state, now) ? "vencendo" : "ativo";
}

/** Todas as concessões, da mais nova para a mais antiga. A tela filtra. */
export function adminVipList(now: Date = new Date()): Promise<AdminVipRow[]> {
  return tolerateSchemaLag(
    () =>
      withAdminRead("painel admin: VIP", async (db) => {
        const rows = await db
          .select({
            grant: vipGrants,
            holderActive: holderActive(db),
            familyName: household.name,
            status: householdSubscriptions.status,
            cancelAtPeriodEnd: householdSubscriptions.cancelAtPeriodEnd,
            stripeDiscount: householdSubscriptions.discountPercent,
          })
          .from(vipGrants)
          .innerJoin(household, eq(household.id, vipGrants.householdId))
          .leftJoin(
            householdSubscriptions,
            eq(householdSubscriptions.householdId, vipGrants.householdId),
          )
          .orderBy(desc(vipGrants.createdAt))
          .limit(500);
        return rows.map(({ status, cancelAtPeriodEnd, ...row }) => {
          const vipStatus = vipStatusOf(row, now);
          return {
            grant: row.grant,
            familyName: row.familyName,
            status: vipStatus,
            stripeDiscount: row.stripeDiscount,
            stillCharged:
              row.grant.cost === "sem_custo" &&
              (vipStatus === "ativo" || vipStatus === "vencendo") &&
              willChargeAgain({ status, cancelAtPeriodEnd: cancelAtPeriodEnd ?? false }),
          };
        });
      }),
    [],
  );
}

/** Famílias de que a pessoa é responsável: as únicas em que um VIP dela pode valer. */
export function adminOwnedFamilies(userId: string): Promise<Array<{ id: string; name: string }>> {
  return withAdminRead("painel admin: famílias da pessoa", (db) =>
    db
      .select({ id: household.id, name: household.name })
      .from(householdMember)
      .innerJoin(household, eq(household.id, householdMember.organizationId))
      .where(and(eq(householdMember.userId, userId), eq(householdMember.role, "owner")))
      .orderBy(household.createdAt),
  );
}

// ---------- Ações na assinatura ----------

export type SubscriptionActionResult = "ok" | "not_found" | "own_family";

export const MAX_TRIAL_DAYS = 90;

/** Soma dias ao teste, a partir de hoje ou do fim que ele já tem. */
export function adminGrantTrialDays(
  admin: AdminActor,
  householdId: string,
  days: number,
): Promise<SubscriptionActionResult> {
  return act("assinatura:dias_teste", async (tx) => {
    if (!(await familyExists(tx, householdId))) return "not_found";
    if (await isMember(tx, admin.adminUserId, householdId)) return "own_family";
    const from = sql`greatest(coalesce(${householdSubscriptions.trialEndsAt}, now()), now())`;
    const next = sql`${from} + make_interval(days => ${days})`;
    await tx
      .insert(householdSubscriptions)
      .values({ householdId, trialEndsAt: sql`now() + make_interval(days => ${days})` })
      .onConflictDoUpdate({
        target: householdSubscriptions.householdId,
        set: { trialEndsAt: next, updatedAt: new Date() },
      });
    await audit(tx, admin, "assinatura:dias_teste", { householdId });
    return "ok";
  });
}

/** Cortesia: tudo liberado, sem Stripe. Com `until`, acaba sozinha, e ninguém é cobrado por isso. */
export function adminSetCourtesy(
  admin: AdminActor,
  householdId: string,
  until: Date | null,
): Promise<SubscriptionActionResult | "assinatura_viva"> {
  return act("assinatura:cortesia", async (tx) => {
    if (!(await familyExists(tx, householdId))) return "not_found";
    if (await isMember(tx, admin.adminUserId, householdId)) return "own_family";
    const [sub] = await tx
      .select({
        status: householdSubscriptions.status,
        cancelAtPeriodEnd: householdSubscriptions.cancelAtPeriodEnd,
      })
      .from(householdSubscriptions)
      .where(eq(householdSubscriptions.householdId, householdId));
    if (sub && willChargeAgain(sub)) return "assinatura_viva";
    const values = { courtesy: true, courtesyUntil: until, courtesyReason: "painel" };
    await tx
      .insert(householdSubscriptions)
      .values({ householdId, ...values })
      .onConflictDoUpdate({
        target: householdSubscriptions.householdId,
        set: { ...values, updatedAt: new Date() },
      });
    await audit(tx, admin, "assinatura:cortesia", { householdId });
    return "ok";
  });
}

export function adminEndCourtesy(
  admin: AdminActor,
  householdId: string,
): Promise<SubscriptionActionResult> {
  return act("assinatura:cortesia_fim", async (tx) => {
    if (await isMember(tx, admin.adminUserId, householdId)) return "own_family";
    const rows = await tx
      .update(householdSubscriptions)
      .set({ courtesy: false, courtesyUntil: null, updatedAt: new Date() })
      .where(eq(householdSubscriptions.householdId, householdId))
      .returning({ id: householdSubscriptions.householdId });
    if (rows.length === 0) return "not_found";
    await audit(tx, admin, "assinatura:cortesia_fim", { householdId });
    return "ok";
  });
}

/**
 * Registro de uma ação na Stripe, cujo efeito não cabe na transação. Quem chama registra antes de chamar, e
 * de novo, com outro código, se falhar: assim a tentativa fica mesmo que o processo caia no meio.
 */
export async function adminRecordBillingAction(
  admin: AdminActor,
  action: string,
  householdId: string | null,
): Promise<void> {
  await act(action, (tx) => audit(tx, admin, action, { householdId }));
}

// ---------- Catálogo ----------

export interface AdminCatalogRow {
  id: string;
  item: string;
  cycle: BillingCycle;
  amount: string;
  onSale: boolean;
  hasStripePrice: boolean;
  createdAt: Date;
}

/** Todas as linhas, inclusive preços antigos: quem assinou por eles continua neles. */
export function adminCatalog(): Promise<AdminCatalogRow[]> {
  return tolerateSchemaLag(
    () =>
      withAdminRead("painel admin: catálogo", async (db) => {
        const rows = await db
          .select({
            id: billingCatalog.id,
            item: billingCatalog.item,
            cycle: billingCatalog.cycle,
            amount: billingCatalog.amount,
            onSale: billingCatalog.onSale,
            hasStripePrice: sql<boolean>`${billingCatalog.stripePriceId} is not null`,
            createdAt: billingCatalog.createdAt,
          })
          .from(billingCatalog)
          .orderBy(billingCatalog.item, billingCatalog.cycle, desc(billingCatalog.createdAt));
        return rows;
      }),
    [],
  );
}

/** A linha que representa o item neste ciclo: a que está à venda, ou a mais nova. */
const currentOf = <T extends { onSale: boolean }>(rows: readonly T[]) =>
  rows.find((row) => row.onSale) ?? rows[0];

const catalogRows = (tx: AdminTx, item: string, cycle: BillingCycle) =>
  tx
    .select()
    .from(billingCatalog)
    .where(and(eq(billingCatalog.item, item), eq(billingCatalog.cycle, cycle)))
    .orderBy(desc(billingCatalog.createdAt))
    .for("update");

export type CatalogPriceResult =
  | "ok"
  | "not_found"
  | "igual"
  /** Contas conectadas têm cobrança só mensal (spec, seção 1). */
  | "sem_anual";

/**
 * Preço novo é linha nova: a antiga sai de venda e fica, porque quem assinou por ela continua nela. A nova nasce
 * sem preço na Stripe, e criar lá é uma ação explícita. Item fora de venda continua fora: mudar preço não põe à venda.
 */
export function adminNewPrice(
  admin: AdminActor,
  input: { item: string; cycle: BillingCycle; amount: string },
): Promise<CatalogPriceResult> {
  const { item, cycle, amount } = input;
  return act("catalogo:preco", async (tx) => {
    if (item === CONNECTED_ITEM && cycle === "ano") return "sem_anual";
    const current = currentOf(await catalogRows(tx, item, cycle));
    if (!current) return "not_found";
    if (money(current.amount).eq(amount)) return "igual";
    await tx.update(billingCatalog).set({ onSale: false }).where(eq(billingCatalog.id, current.id));
    await tx
      .insert(billingCatalog)
      .values({ item, cycle, amount, currency: current.currency, onSale: current.onSale });
    await audit(tx, admin, "catalogo:preco");
    return "ok";
  });
}

export type CatalogSaleResult =
  | "ok"
  | "not_found"
  /** Contas conectadas só vão à venda quando a conexão com bancos existir. */
  | "conexao_inexistente";

/** Liga ou desliga a venda. Tirar de venda não muda quem já assina. */
export function adminSetOnSale(
  admin: AdminActor,
  input: { item: string; cycle: BillingCycle; onSale: boolean },
): Promise<CatalogSaleResult> {
  const { item, cycle, onSale } = input;
  return act(onSale ? "catalogo:vender" : "catalogo:parar", async (tx) => {
    if (onSale && item === CONNECTED_ITEM) return "conexao_inexistente";
    const current = currentOf(await catalogRows(tx, item, cycle));
    if (!current) return "not_found";
    await tx.update(billingCatalog).set({ onSale }).where(eq(billingCatalog.id, current.id));
    await audit(tx, admin, onSale ? "catalogo:vender" : "catalogo:parar");
    return "ok";
  });
}

/** Linha que a Stripe vai receber. Null: já tem preço, saiu de venda ou não existe. */
export function adminPriceToCreate(id: string) {
  return withAdminRead("painel admin: preço a criar", async (db) => {
    const [row] = await db
      .select({
        id: billingCatalog.id,
        item: billingCatalog.item,
        cycle: billingCatalog.cycle,
        amount: billingCatalog.amount,
        currency: billingCatalog.currency,
      })
      .from(billingCatalog)
      .where(
        and(
          eq(billingCatalog.id, id),
          eq(billingCatalog.onSale, true),
          isNull(billingCatalog.stripePriceId),
        ),
      );
    return row ?? null;
  });
}

/** Guarda o preço criado na Stripe, por ação explícita de quem clicou. */
export function adminSaveStripePrice(
  admin: AdminActor,
  id: string,
  stripePriceId: string,
): Promise<"ok" | "not_found"> {
  return act("catalogo:stripe", async (tx) => {
    const rows = await tx
      .update(billingCatalog)
      .set({ stripePriceId })
      .where(and(eq(billingCatalog.id, id), isNull(billingCatalog.stripePriceId)))
      .returning({ id: billingCatalog.id });
    if (rows.length === 0) return "not_found";
    await audit(tx, admin, "catalogo:stripe");
    return "ok";
  });
}

// ---------- Uso, receita e saúde da cobrança ----------

export interface AdminFamilyUsage {
  householdId: string;
  entries: number;
  messages: number;
}

/** Lançamentos e mensagens de cada família no mês dela. Só contagens. */
export function adminMonthUsage(): Promise<AdminFamilyUsage[]> {
  return tolerateSchemaLag(
    () =>
      withAdminRead("painel admin: uso do mês", async (db) => {
        const rows = await db.execute<{
          household_id: string;
          entries: number;
          messages: number;
        }>(sql`
          with months as (
            select h.id as household_id,
              to_char(now() at time zone coalesce(s.timezone, 'America/Sao_Paulo'), 'YYYY-MM') as month
            from household h
            left join household_settings s on s.household_id = h.id
          )
          select m.household_id,
            ((select count(*) from transactions t
                where t.household_id = m.household_id and t.usage_month = m.month)
             + (select count(*) from card_purchases c
                where c.household_id = m.household_id and c.usage_month = m.month))::int as entries,
            coalesce((select u.messages from household_usage u
                where u.household_id = m.household_id and u.month = m.month), 0)::int as messages
          from months m`);
        return rows.map((row) => ({
          householdId: row.household_id,
          entries: row.entries,
          messages: row.messages,
        }));
      }),
    [],
  );
}

/** Gasto de IA por família desde `monthStart` (`AAAA-MM-01`), em dólar. */
export function adminAiCostByFamily(monthStart: string): Promise<Map<string, string>> {
  return tolerateSchemaLag(
    () =>
      withAdminRead("painel admin: custo de IA", async (db) => {
        const rows = await db
          .select({
            householdId: aiUsage.householdId,
            cost: sql<string>`coalesce(sum(${aiUsage.costUsd}), 0)::text`,
          })
          .from(aiUsage)
          .where(gte(aiUsage.day, monthStart))
          .groupBy(aiUsage.householdId);
        return new Map(rows.map((row) => [row.householdId, row.cost]));
      }),
    new Map(),
  );
}

/** Reais por dólar, na última PTAX guardada. Null: sem cotação. */
export function adminUsdRate(): Promise<{ rate: string; date: string } | null> {
  return tolerateSchemaLag(
    () =>
      withAdminRead("painel admin: dólar", async (db) => {
        const [row] = await db
          .select({ rate: marketFx.rate, date: marketFx.date })
          .from(marketFx)
          .where(eq(marketFx.currency, "USD"))
          .orderBy(desc(marketFx.date))
          .limit(1);
        return row ?? null;
      }),
    null,
  );
}

export interface AdminBillingHealth {
  lastReceivedAt: Date | null;
  lastType: string | null;
  lastLive: boolean | null;
  pending: number;
  /** Erros por código, do mais frequente para o menos. */
  errors: Array<{ code: string; count: number; lastAt: Date | null }>;
}

const NO_HEALTH: AdminBillingHealth = {
  lastReceivedAt: null,
  lastType: null,
  lastLive: null,
  pending: 0,
  errors: [],
};

/** Situação do webhook, pelos eventos guardados. Só códigos e contagens. */
export function adminBillingHealth(): Promise<AdminBillingHealth> {
  return tolerateSchemaLag(
    () =>
      withAdminRead("painel admin: saúde da cobrança", async (db) => {
        const [[last], [pending], errors] = await Promise.all([
          db
            .select({
              at: billingEvents.receivedAt,
              type: billingEvents.type,
              live: billingEvents.livemode,
            })
            .from(billingEvents)
            .orderBy(desc(billingEvents.receivedAt))
            .limit(1),
          db.select({ n: count() }).from(billingEvents).where(isNull(billingEvents.processedAt)),
          db
            .select({
              code: sql<string>`${billingEvents.errorCode}`,
              count: count(),
              lastAt: sql<string | null>`max(${billingEvents.receivedAt})`,
            })
            .from(billingEvents)
            .where(isNotNull(billingEvents.errorCode))
            .groupBy(billingEvents.errorCode)
            .orderBy(desc(count())),
        ]);
        return {
          lastReceivedAt: last?.at ?? null,
          lastType: last?.type ?? null,
          lastLive: last?.live ?? null,
          pending: pending?.n ?? 0,
          errors: errors.map((row) => ({
            code: row.code,
            count: row.count,
            lastAt: row.lastAt ? new Date(row.lastAt) : null,
          })),
        };
      }),
    NO_HEALTH,
  );
}

// ---------- Telas novas ----------

export interface AdminFamilyProduct {
  mainCurrency: string;
  reports: number;
  lastReportAt: Date | null;
  statements: number;
  lastStatementAt: Date | null;
  notifications: number;
  unread: number;
  /** Tem dívida cadastrada: só sim ou não. */
  debts: boolean;
}

/** Moeda principal, relatórios e notificações de UMA família: só código, datas e contagens. */
export function adminFamilyProduct(id: string): Promise<AdminFamilyProduct | null> {
  return tolerateSchemaLag(
    () =>
      withAdminRead("painel admin: telas da família", async (db) => {
        const [[settings], [reports], [statements], [notifications], debts] = await Promise.all([
          db
            .select({ currency: householdSettings.mainCurrency })
            .from(householdSettings)
            .where(eq(householdSettings.householdId, id)),
          db
            .select({ n: count(), at: sql<string | null>`max(${householdReports.createdAt})` })
            .from(householdReports)
            .where(eq(householdReports.householdId, id)),
          db
            .select({
              n: count(),
              at: sql<string | null>`max(${householdStatements.generatedAt})`,
            })
            .from(householdStatements)
            .where(eq(householdStatements.householdId, id)),
          db
            .select({
              n: count(),
              unread: sql<number>`count(*) filter (where ${householdNotifications.readAt} is null)::int`,
            })
            .from(householdNotifications)
            .where(eq(householdNotifications.householdId, id)),
          db.execute<{ used: boolean }>(
            sql`select exists(select 1 from debts where household_id = ${id}) as used`,
          ),
        ]);
        return {
          mainCurrency: settings?.currency ?? "BRL",
          reports: reports?.n ?? 0,
          lastReportAt: reports?.at ? new Date(reports.at) : null,
          statements: statements?.n ?? 0,
          lastStatementAt: statements?.at ? new Date(statements.at) : null,
          notifications: notifications?.n ?? 0,
          unread: notifications?.unread ?? 0,
          debts: debts[0]?.used ?? false,
        };
      }),
    null,
  );
}

export interface AdminProductCounts {
  /** Famílias por moeda principal. */
  currencies: Array<{ currency: string; families: number }>;
  /** Relatórios da família gerados nos últimos 30 dias, por tipo. */
  statements: Array<{ kind: ReportKind; total: number }>;
  notifications: { total: number; unread: number };
  /** Famílias com dívida cadastrada. */
  debtFamilies: number;
}

const NO_PRODUCT: AdminProductCounts = {
  currencies: [],
  statements: [],
  notifications: { total: 0, unread: 0 },
  debtFamilies: 0,
};

/** Bloco da tela Sistema: só contagens, nada identifica uma família. */
export function adminProductCounts(now: Date = new Date()): Promise<AdminProductCounts> {
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return tolerateSchemaLag(
    () =>
      withAdminRead("painel admin: uso das telas", async (db) => {
        const [currencies, statements, [notifications], debts] = await Promise.all([
          db
            .select({ currency: householdSettings.mainCurrency, families: count() })
            .from(householdSettings)
            .groupBy(householdSettings.mainCurrency)
            .orderBy(desc(count())),
          db
            .select({ kind: householdStatements.kind, total: count() })
            .from(householdStatements)
            .where(gte(householdStatements.generatedAt, since))
            .groupBy(householdStatements.kind)
            .orderBy(desc(count())),
          db
            .select({
              total: count(),
              unread: sql<number>`count(*) filter (where ${householdNotifications.readAt} is null)::int`,
            })
            .from(householdNotifications)
            .where(gte(householdNotifications.createdAt, since)),
          db.execute<{ n: number }>(sql`select count(distinct household_id)::int as n from debts`),
        ]);
        return {
          currencies,
          statements,
          notifications: {
            total: notifications?.total ?? 0,
            unread: notifications?.unread ?? 0,
          },
          debtFamilies: debts[0]?.n ?? 0,
        };
      }),
    NO_PRODUCT,
  );
}
