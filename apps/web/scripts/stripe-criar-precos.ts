// Cria na Stripe os produtos e preços do catálogo e grava `stripe_price_id` em `billing_catalog`
// (ADR-0023). Rodada à mão, por quem tem a chave. Sem `--gravar`, só lista o que faria.
//
//   pnpm exec tsx apps/web/scripts/stripe-criar-precos.ts            # mostra o plano
//   pnpm exec tsx apps/web/scripts/stripe-criar-precos.ts --gravar   # cria e grava
//
// Precisa de STRIPE_SECRET_KEY e ADMIN_DATABASE_URL. Recusa chave de produção sem STRIPE_ALLOW_LIVE=true.
// Pode rodar de novo: linha com preço é pulada, e a `lookup_key` evita preço duplicado se cair no meio.
// Só mostra o tipo da chave, nunca o valor.
import { and, billingCatalog, closeAllPools, eq, isNull, withAdmin } from "@organizeup/db";
import { stripeUnitAmount } from "@organizeup/domain";
import Stripe from "stripe";
import { stripeKeyMode, stripeUsable } from "../src/lib/billing/stripe-key";

const NAMES: Record<string, string> = {
  base: "OrganizeUp Base",
  "modulo:investimentos": "OrganizeUp Investimentos",
  "modulo:aposentadoria": "OrganizeUp Aposentadoria",
  "modulo:dividas": "OrganizeUp Dívidas",
  "modulo:metas": "OrganizeUp Metas e viagens",
  assistente: "OrganizeUp Assistente com IA",
  "moeda:BRL": "OrganizeUp Moeda adicional: real",
  "moeda:USD": "OrganizeUp Moeda adicional: dólar",
  "moeda:EUR": "OrganizeUp Moeda adicional: euro",
  familia: "OrganizeUp Família completa",
  familia_mensagens: "OrganizeUp Família completa: mensagens a mais",
  contas_conectadas: "OrganizeUp Contas conectadas",
};

/** Degraus são preços do mesmo produto; cada módulo e cada moeda têm o seu. */
const productKey = (item: string) => {
  const [kind = ""] = item.split(":");
  return kind === "modulo" || kind === "moeda" ? item : kind;
};

const write = process.argv.includes("--gravar");
const mode = stripeKeyMode();
console.log(`Chave da Stripe: ${mode}.`);
if (!stripeUsable()) {
  throw new Error("Chave recusada: ausente, inválida, ou de produção sem STRIPE_ALLOW_LIVE=true.");
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!.trim());
const rows = await withAdmin("criar preços do catálogo na Stripe", (admin) =>
  admin
    .select()
    .from(billingCatalog)
    // Fora de venda fica fora daqui: contas conectadas só ganham preço quando a conexão existir.
    .where(and(isNull(billingCatalog.stripePriceId), eq(billingCatalog.onSale, true))),
);
console.log(`${rows.length} preços sem id da Stripe.`);

async function product(key: string): Promise<string> {
  const found = await stripe.products.search({ query: `metadata["organizeup_item"]:"${key}"` });
  const known = found.data[0];
  if (known) return known.id;
  const name = NAMES[key];
  if (!name) throw new Error(`Item sem nome de produto: ${key}`);
  const created = await stripe.products.create({ name, metadata: { organizeup_item: key } });
  return created.id;
}

const products = new Map<string, string>();
for (const row of rows) {
  const key = productKey(row.item);
  console.log(`${row.item} (${row.cycle}): R$ ${row.amount}${write ? "" : " [só mostrando]"}`);
  if (!write) continue;
  if (!products.has(key)) products.set(key, await product(key));
  const lookup = `organizeup:${row.id}`;
  const existing = await stripe.prices.list({ lookup_keys: [lookup], limit: 1 });
  const price =
    existing.data[0] ??
    (await stripe.prices.create({
      product: products.get(key)!,
      currency: row.currency.toLowerCase(),
      unit_amount: stripeUnitAmount(row.amount),
      recurring: { interval: row.cycle === "ano" ? "year" : "month" },
      lookup_key: lookup,
      metadata: { organizeup_item: row.item, organizeup_cycle: row.cycle },
    }));
  await withAdmin("gravar id do preço da Stripe", (admin) =>
    admin
      .update(billingCatalog)
      .set({ stripePriceId: price.id })
      .where(eq(billingCatalog.id, row.id)),
  );
}
console.log(write ? "Pronto." : "Nada foi criado. Rode com --gravar para criar.");
await closeAllPools();
