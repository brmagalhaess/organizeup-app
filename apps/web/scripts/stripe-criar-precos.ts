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
import Stripe from "stripe";
import { createCatalogPrice } from "../src/lib/billing/stripe-prices";
import { stripeKeyMode, stripeUsable } from "../src/lib/billing/stripe-key";

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

for (const row of rows) {
  console.log(`${row.item} (${row.cycle}): R$ ${row.amount}${write ? "" : " [só mostrando]"}`);
  if (!write) continue;
  const stripePriceId = await createCatalogPrice(stripe, row);
  await withAdmin("gravar id do preço da Stripe", (admin) =>
    admin.update(billingCatalog).set({ stripePriceId }).where(eq(billingCatalog.id, row.id)),
  );
}
console.log(write ? "Pronto." : "Nada foi criado. Rode com --gravar para criar.");
await closeAllPools();
