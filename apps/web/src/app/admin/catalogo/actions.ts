"use server";
// Catálogo (ADR-0025). Preço novo é linha nova: a tabela guarda todos, e quem assinou por um preço continua nele.
// Criar preço na Stripe só por clique explícito, e nunca para contas conectadas.
import {
  adminNewPrice,
  adminPriceToCreate,
  adminSaveStripePrice,
  adminSetOnSale,
} from "@organizeup/db";
import { BILLING_CYCLES, CONNECTED_ITEM, money, toDbAmount } from "@organizeup/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { billingGateway } from "@/lib/billing/gateway";
import { stripeUsable } from "@/lib/billing/stripe-key";
import { requireAdmin } from "@/lib/session";
import { keyNotice } from "../cobranca/estado";
import { runAdminAction, targetId } from "../painel";
import { done, failed, type AdminResult } from "../painel-result";

/** A Stripe não aceita menos que isso em reais. */
const MIN_PRICE = "0.50";

const line = z.object({
  item: z.string().regex(/^[a-z_]{1,40}(:[A-Za-z0-9_]{1,40})?$/),
  cycle: z.enum(BILLING_CYCLES),
});

const NOT_CONNECTED =
  "Contas conectadas não vão à venda enquanto a conexão com bancos não existir.";

const refresh = () => {
  revalidatePath("/admin/catalogo");
  revalidatePath("/admin/cobranca");
  revalidatePath("/app/assinatura");
};

/** Aceita "12,90" e "12.90". Null: não é um preço. */
function parsePrice(raw: unknown): string | null {
  const text = String(raw ?? "").trim();
  if (!/^\d{1,8}([.,]\d{1,2})?$/.test(text)) return null;
  return toDbAmount(text.replace(",", "."));
}

export async function setPrice(form: FormData): Promise<AdminResult> {
  const session = await requireAdmin();
  const parsed = line.safeParse({ item: form.get("item"), cycle: form.get("cycle") });
  if (!parsed.success) return failed("Item inválido.");
  const amount = parsePrice(form.get("amount"));
  if (!amount) return failed("Escreva o preço assim: 12,90.");
  if (money(amount).lt(MIN_PRICE)) return failed("O preço mínimo é R$ 0,50.");
  return runAdminAction("admin_catalog_price_failed", async () => {
    const result = await adminNewPrice(
      { adminUserId: session.user.id },
      { ...parsed.data, amount },
    );
    if (result === "not_found") return failed("Item não encontrado.");
    if (result === "igual") return failed("Este já é o preço atual.");
    if (result === "sem_anual") return failed("Contas conectadas não têm preço anual.");
    refresh();
    return done("Preço novo salvo. Vale só para quem assinar depois.");
  });
}

export async function setSale(form: FormData): Promise<AdminResult> {
  const session = await requireAdmin();
  const parsed = line.safeParse({ item: form.get("item"), cycle: form.get("cycle") });
  if (!parsed.success) return failed("Item inválido.");
  const onSale = form.get("enabled") === "true";
  return runAdminAction("admin_catalog_sale_failed", async () => {
    const result = await adminSetOnSale(
      { adminUserId: session.user.id },
      { ...parsed.data, onSale },
    );
    if (result === "not_found") return failed("Item não encontrado.");
    if (result === "conexao_inexistente") return failed(NOT_CONNECTED);
    refresh();
    return done(onSale ? "À venda." : "Fora de venda. Quem já assina não muda.");
  });
}

/** Ação explícita: é a única porta do painel para criar preço na Stripe. */
export async function createStripePrice(form: FormData): Promise<AdminResult> {
  const session = await requireAdmin();
  const id = targetId.safeParse(form.get("id"));
  if (!id.success) return failed("Item inválido.");
  if (!stripeUsable()) return failed(keyNotice().text);
  return runAdminAction("admin_catalog_stripe_failed", async () => {
    const row = await adminPriceToCreate(id.data);
    if (!row) return failed("Este preço já está na Stripe, ou saiu de venda.");
    if (row.item === CONNECTED_ITEM) return failed(NOT_CONNECTED);
    const stripePriceId = await billingGateway().createPrice(row);
    const result = await adminSaveStripePrice(
      { adminUserId: session.user.id },
      id.data,
      stripePriceId,
    );
    if (result === "not_found") return failed("Este preço já está na Stripe.");
    refresh();
    return done("Preço criado na Stripe.");
  });
}
