// Aplica os eventos da Stripe à assinatura da família (ADR-0023). O webhook é a fonte da verdade: a web
// confere a assinatura e guarda o evento; aqui, no worker, ele vira estado na tabela local, em ordem de
// quando aconteceu na Stripe. Roda com `fromJob`, porque só o worker grava no plano, uma família por
// transação. Evento repetido não chega aqui: a chave é o id. Evento velho não desfaz o novo.
import {
  finishBillingEvent,
  fromJob,
  householdNotifications,
  householdOfCustomer,
  householdSubscriptions,
  householdTimezone,
  listHouseholdIds,
  pendingBillingEvents,
  priceBook,
  readFamilyVip,
  readPlatformFlags,
  readSubscription,
  retryBillingEvent,
  sql,
  withHousehold,
  withWorkerHousehold,
  type HouseholdSubscription,
  type SuggestionKind,
  type StoredBillingEvent,
  type TenantTx,
} from "@organizeup/db";
import {
  annualRenewalDue,
  todayIn,
  vipNoticeDue,
  willChargeAgain,
  type BillingCycle,
  type BillingModule,
  type FamilyAccess,
  type SubscribedItem,
} from "@organizeup/domain";
import { z } from "zod";
import { messageColumns } from "./shared";
import { billingNoticeText } from "./texts";

/** Lista fechada do que sai de cada evento. Tudo o mais, inclusive e-mail e nome do pagador, fica fora. */
const priceLine = z.object({ price: z.string(), quantity: z.number().int().positive() });

export const billingEventData = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("checkout"),
    subscriptionId: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("subscription"),
    subscriptionId: z.string(),
    status: z.string(),
    items: z.array(priceLine),
    periodStart: z.iso.datetime().nullable(),
    periodEnd: z.iso.datetime().nullable(),
    cancelAtPeriodEnd: z.boolean(),
    canceledAt: z.iso.datetime().nullable(),
    scheduleId: z.string().nullable(),
    /** Desconto VIP em vigor. Evento guardado antes dele vem sem o campo, e isso é sem desconto. */
    discountPercent: z.number().int().min(1).max(99).nullable().optional(),
  }),
  z.object({
    kind: z.literal("schedule"),
    scheduleId: z.string(),
    /** Null: não há troca marcada nesse evento. O `created` nasce assim, antes do `updated`. */
    next: z.object({ items: z.array(priceLine), at: z.iso.datetime() }).nullable(),
    /** O schedule acabou, foi solto ou cancelado. */
    ended: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal("invoice_paid"),
    subscriptionId: z.string().nullable(),
    paidAt: z.iso.datetime(),
    amountPaid: z.number().int().nonnegative(),
  }),
  z.object({ kind: z.literal("invoice_failed"), subscriptionId: z.string().nullable() }),
  z.object({ kind: z.literal("refund"), fully: z.boolean() }),
  z.object({ kind: z.literal("ignored") }),
]);

export type BillingEventData = z.infer<typeof billingEventData>;

/** Quantas passadas um evento espera antes de fechar sem aplicar: a fila passa uma vez por minuto. */
export const MAX_EVENT_ATTEMPTS = 60;

class BillingEventProblem extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

type Book = Awaited<ReturnType<typeof priceBook>>;

const PAYING = new Set(["active", "trialing", "past_due"]);
/** Situação que não volta: quem acabou não precisa do catálogo para acabar. */
const ENDED = new Set(["canceled", "incomplete_expired"]);

/**
 * Precedência no empate: a Stripe dá o horário em segundos, e o id não tem ordem. No mesmo segundo vale a
 * situação mais adiantada, porque ela só anda para a frente.
 */
const STATUS_RANK: Record<string, number> = {
  incomplete: 0,
  trialing: 1,
  active: 2,
  past_due: 2,
  unpaid: 2,
  paused: 2,
  incomplete_expired: 3,
  canceled: 4,
};
const rankOf = (status: string | null) => STATUS_RANK[status ?? ""] ?? 0;

function pricedItems(lines: z.infer<typeof priceLine>[], book: Book) {
  const items: SubscribedItem[] = [];
  let cycle: BillingCycle | null = null;
  for (const { price, quantity } of lines) {
    const known = book.get(price);
    // Preço que o catálogo não conhece: melhor esperar o catálogo do que dar acesso errado.
    if (!known) throw new BillingEventProblem("preco_desconhecido");
    items.push({ price, item: known.item, amount: known.amount, quantity });
    cycle = known.cycle;
  }
  return { items, cycle };
}

const toDate = (value: string | null) => (value ? new Date(value) : null);

async function currentRow(tx: TenantTx, householdId: string) {
  const [row] = await tx
    .select()
    .from(householdSubscriptions)
    .where(sql`${householdSubscriptions.householdId} = ${householdId}`);
  return row ?? null;
}

async function save(
  tx: TenantTx,
  householdId: string,
  values: Partial<typeof householdSubscriptions.$inferInsert>,
): Promise<void> {
  // Família sem linha, o que só um erro nosso causa: sem situação da Stripe, a cortesia continua. Sem
  // isto, um evento de fatura criaria uma linha vazia e tiraria o acesso.
  const orphan = values.status ? {} : { courtesy: true, courtesyReason: "sem_linha" };
  await tx
    .insert(householdSubscriptions)
    .values({ householdId, ...orphan, ...values })
    .onConflictDoUpdate({
      target: householdSubscriptions.householdId,
      set: { ...values, updatedAt: new Date() },
    });
}

/** Outra assinatura da mesma família: só entra a que cobra e no lugar de uma que acabou. */
function replaces(row: HouseholdSubscription | null, subscriptionId: string, status: string) {
  if (!row?.stripeSubscriptionId || row.stripeSubscriptionId === subscriptionId) return true;
  return PAYING.has(status) && !PAYING.has(row.status ?? "");
}

function isStale(row: HouseholdSubscription | null, at: Date): boolean {
  return Boolean(row?.lastEventAt && at < row.lastEventAt);
}

/** A mesma assinatura: `canceled` não volta, `incomplete` não desfaz pagamento, e no empate manda a situação. */
function overrides(row: HouseholdSubscription | null, status: string, at: Date): boolean {
  if (!row?.status) return true;
  if (row.status === "canceled" && status !== "canceled") return false;
  if (status === "incomplete" && PAYING.has(row.status)) return false;
  if (!row.lastEventAt || at > row.lastEventAt) return true;
  return rankOf(status) >= rankOf(row.status);
}

const NO_SCHEDULE = {
  stripeScheduleId: null,
  scheduledItems: null,
  scheduledCycle: null,
  scheduledAt: null,
};

export type BillingOutcome = "aplicado" | "sem_efeito" | "assinatura_duplicada";

/** Aplica um evento dentro da transação da família. */
export async function applyBillingEvent(
  tx: TenantTx,
  event: Pick<StoredBillingEvent, "stripeAt" | "customerId"> & {
    householdId: string;
    data: BillingEventData;
  },
  book: Book,
): Promise<BillingOutcome> {
  const { householdId, data, stripeAt, customerId } = event;
  const row = await currentRow(tx, householdId);
  const customer = customerId && !row?.stripeCustomerId ? { stripeCustomerId: customerId } : {};

  switch (data.kind) {
    case "ignored":
      return "sem_efeito";

    case "checkout": {
      // Não mexe na ordem: a assinatura em si chega por `customer.subscription.*`.
      await save(tx, householdId, {
        ...customer,
        ...(data.subscriptionId && !row?.stripeSubscriptionId
          ? { stripeSubscriptionId: data.subscriptionId }
          : {}),
      });
      return "aplicado";
    }

    case "subscription": {
      if (isStale(row, stripeAt)) return "sem_efeito";
      if (!replaces(row, data.subscriptionId, data.status)) {
        // Segunda assinatura paga: a Stripe cobra, e o plano não entra. Alguém precisa olhar.
        return PAYING.has(data.status) ? "assinatura_duplicada" : "sem_efeito";
      }
      const same = row?.stripeSubscriptionId === data.subscriptionId;
      if (same && !overrides(row, data.status, stripeAt)) return "sem_efeito";
      // Cancelar não pode esperar o catálogo: o preço pode já ter saído dele.
      const unknown = data.items.some((line) => !book.has(line.price));
      const { items, cycle } =
        unknown && ENDED.has(data.status) && row
          ? { items: row.items, cycle: row.cycle }
          : pricedItems(data.items, book);
      const scheduleKept = row?.scheduleEventAt && stripeAt <= row.scheduleEventAt;
      await save(tx, householdId, {
        ...customer,
        stripeSubscriptionId: data.subscriptionId,
        status: data.status,
        cycle,
        items,
        currentPeriodStart: toDate(data.periodStart),
        currentPeriodEnd: toDate(data.periodEnd),
        cancelAtPeriodEnd: data.cancelAtPeriodEnd,
        canceledAt: toDate(data.canceledAt),
        discountPercent: data.discountPercent ?? null,
        lastEventAt: stripeAt,
        // Assinatura sem schedule só limpa a troca marcada se for mais nova que o evento do schedule.
        ...(data.scheduleId
          ? { stripeScheduleId: data.scheduleId }
          : scheduleKept
            ? {}
            : NO_SCHEDULE),
      });
      return "aplicado";
    }

    case "schedule": {
      // Schedule que acabou não ressuscita, venha o que vier depois.
      if (row?.scheduleEndedId === data.scheduleId) return "sem_efeito";
      if (row?.scheduleEventAt && stripeAt < row.scheduleEventAt) return "sem_efeito";
      if (data.ended) {
        const mine = row?.stripeScheduleId === data.scheduleId;
        await save(tx, householdId, {
          ...(mine ? NO_SCHEDULE : {}),
          scheduleEndedId: data.scheduleId,
          scheduleEventAt: stripeAt,
        });
        return "aplicado";
      }
      if (!data.next) {
        // O `created` chega sem a fase seguinte. No mesmo segundo do `updated`, ele não apaga a troca.
        const known = row?.stripeScheduleId === data.scheduleId && row.scheduledItems;
        if (known && row.scheduleEventAt && stripeAt <= row.scheduleEventAt) return "sem_efeito";
        await save(tx, householdId, {
          ...customer,
          ...NO_SCHEDULE,
          stripeScheduleId: data.scheduleId,
          scheduleEventAt: stripeAt,
        });
        return "aplicado";
      }
      const { items, cycle } = pricedItems(data.next.items, book);
      await save(tx, householdId, {
        ...customer,
        stripeScheduleId: data.scheduleId,
        scheduledItems: items,
        scheduledCycle: cycle,
        scheduledAt: new Date(data.next.at),
        scheduleEventAt: stripeAt,
      });
      return "aplicado";
    }

    case "invoice_paid": {
      const paidAt = new Date(data.paidAt);
      const first =
        data.amountPaid > 0 && (!row?.firstPaidAt || paidAt < row.firstPaidAt)
          ? { firstPaidAt: paidAt }
          : {};
      await save(tx, householdId, { ...customer, ...first, paymentFailedAt: null });
      return "aplicado";
    }

    case "invoice_failed": {
      if (isStale(row, stripeAt)) return "sem_efeito";
      await save(tx, householdId, { ...customer, paymentFailedAt: stripeAt });
      await notify(
        tx,
        householdId,
        "assinatura_falhou",
        `assinatura-falha:${stripeAt.toISOString().slice(0, 10)}`,
      );
      return "aplicado";
    }

    case "refund": {
      if (!data.fully || row?.refundedAt) return "sem_efeito";
      await save(tx, householdId, { refundedAt: stripeAt });
      return "aplicado";
    }
  }
}

type BillingNotice = "assinatura_falhou" | "assinatura_renovacao" | "vip_vencendo";

const HREF = "/app/assinatura";

async function notify(
  tx: TenantTx,
  householdId: string,
  kind: BillingNotice,
  dedupeKey: string,
  date?: string,
): Promise<boolean> {
  const { message, ...text } = billingNoticeText(kind, date);
  const rows = await tx
    .insert(householdNotifications)
    .values({
      householdId,
      kind,
      ...text,
      ...messageColumns(message),
      data: date ? { date } : {},
      href: HREF,
      dedupeKey,
    })
    .onConflictDoNothing()
    .returning({ id: householdNotifications.id });
  return rows.length > 0;
}

interface Log {
  error: (data: object, message: string) => void;
  info: (data: object, message: string) => void;
}

export interface BillingRunResult {
  applied: number;
  waiting: number;
  closed: number;
  /** Assinaturas pagas que não entraram, porque a família já tinha outra. */
  duplicates: number;
}

/** O código do Postgres vem em `cause`: o Drizzle embrulha o erro. */
function pgCode(error: unknown): string | undefined {
  for (
    let current: unknown = error;
    typeof current === "object" && current !== null;
    current = (current as { cause?: unknown }).cause
  ) {
    const { code } = current as { code?: unknown };
    if (typeof code === "string") return code;
  }
  return undefined;
}

/** Sem conserto: esperar 60 passadas não muda nada. */
const FINAL_CODES: Record<string, string> = {
  "23503": "familia_apagada",
  "23505": "id_de_outra_familia",
};

/**
 * Uma passada pela fila. Sem achar a família, ou com preço que o catálogo ainda não conhece, o evento
 * fica para a próxima passada; depois de `MAX_EVENT_ATTEMPTS`, fecha com o código, sem aplicar.
 */
export async function runBillingEvents(log: Log, limit = 200): Promise<BillingRunResult> {
  const events = await pendingBillingEvents(limit);
  const result: BillingRunResult = { applied: 0, waiting: 0, closed: 0, duplicates: 0 };
  if (events.length === 0) return result;
  const book = await priceBook();

  for (const event of events) {
    const postpone = async (code: string) => {
      const giveUp = event.attempts + 1 >= MAX_EVENT_ATTEMPTS;
      await retryBillingEvent(event.id, code, giveUp);
      if (giveUp) result.closed += 1;
      else result.waiting += 1;
      log.error({ event: event.id, code, giveUp }, "evento da Stripe não aplicado");
    };
    const parsed = billingEventData.safeParse(event.data);
    if (!parsed.success) {
      await retryBillingEvent(event.id, "formato_invalido", true);
      result.closed += 1;
      continue;
    }
    const householdId =
      event.householdId ?? (event.customerId ? await householdOfCustomer(event.customerId) : null);
    if (!householdId) {
      await postpone("sem_familia");
      continue;
    }
    try {
      const outcome = await withWorkerHousehold(householdId, (tx) =>
        applyBillingEvent(tx, { ...event, householdId, data: parsed.data }, book),
      );
      if (outcome === "assinatura_duplicada") {
        await retryBillingEvent(event.id, outcome, true);
        result.duplicates += 1;
        log.error({ event: event.id, householdId, code: outcome }, "assinatura paga não entrou");
        continue;
      }
      await finishBillingEvent(event.id);
      result.applied += 1;
    } catch (error) {
      // Sem a mensagem do erro.
      const final = FINAL_CODES[pgCode(error) ?? ""];
      if (final) {
        await retryBillingEvent(event.id, final, true);
        result.closed += 1;
        log.error({ event: event.id, code: final }, "evento da Stripe fechado sem aplicar");
        continue;
      }
      await postpone(error instanceof BillingEventProblem ? error.code : "falha");
    }
  }
  return result;
}

/**
 * Aviso 30 dias antes da renovação anual, um por período. Fica na central de notificações: a Stripe
 * não sabe do fuso da família, e o e-mail do worker ainda não existe (ver ADR-0023).
 */
export async function runBillingRenewals(log: Log, now: Date = new Date()): Promise<number> {
  const ids = await listHouseholdIds();
  let sent = 0;
  for (const householdId of ids) {
    try {
      const ctx = fromJob({ householdId });
      const row = await readSubscription(ctx);
      const due = row && annualRenewalDue({ ...row, now });
      if (!due || !row.currentPeriodEnd) continue;
      const end = row.currentPeriodEnd;
      const created = await withHousehold(ctx, async (tx) => {
        const date = todayIn(await householdTimezone(tx, householdId), end);
        return notify(
          tx,
          householdId,
          "assinatura_renovacao",
          `assinatura-renovacao:${date}`,
          date,
        );
      });
      if (created) sent += 1;
    } catch (error) {
      log.error(
        { householdId, code: (error as { code?: string }).code },
        "aviso de renovação falhou",
      );
    }
  }
  return sent;
}

/**
 * Aviso de que o VIP sem custo está acabando, um por data de fim: sem isso a família cai em só leitura de
 * surpresa. Quem já assinou para depois do VIP não precisa dele. Com a chave desligada, ninguém perde nada.
 */
export async function runVipNotices(log: Log, now: Date = new Date()): Promise<number> {
  const { billingEnabled } = await readPlatformFlags();
  if (!billingEnabled) return 0;
  let sent = 0;
  for (const householdId of await listHouseholdIds()) {
    try {
      const ctx = fromJob({ householdId });
      const vip = await readFamilyVip(ctx);
      if (!vip?.endsAt || !vipNoticeDue(vip, now)) continue;
      const row = await readSubscription(ctx);
      if (row && willChargeAgain(row)) continue;
      const end = vip.endsAt;
      const created = await withHousehold(ctx, async (tx) => {
        const date = todayIn(await householdTimezone(tx, householdId), end);
        return notify(tx, householdId, "vip_vencendo", `vip-vencendo:${date}`, date);
      });
      if (created) sent += 1;
    } catch (error) {
      log.error({ householdId, code: (error as { code?: string }).code }, "aviso de VIP falhou");
    }
  }
  return sent;
}

/** Módulo de cada agente diário. Null: faz parte da Base. */
export const AGENT_MODULE: Record<string, BillingModule | null> = {
  categorias: null,
  relatorios: null,
  "categorias-ia": "assistente",
  investimentos: "investimentos",
  dividas: "dividas",
  aposentadoria: "aposentadoria",
  viagens: "metas",
  metas: "metas",
};

/** Módulo que cada tipo de sugestão altera. Fora da lista: Base. */
export const SUGGESTION_MODULE: Partial<Record<SuggestionKind, BillingModule>> = {
  aporte_divida: "dividas",
  aporte_investimento: "aposentadoria",
  investimento: "investimentos",
  meta: "metas",
  viagem: "metas",
};

/** Agente de módulo desligado não roda; em só leitura, nenhum roda. Agente fora da lista também não. */
export function agentMayRun(agent: string, access: FamilyAccess): boolean {
  if (access.mode === "leitura" || !(agent in AGENT_MODULE)) return false;
  const module = AGENT_MODULE[agent];
  return !module || access.modules.includes(module);
}
