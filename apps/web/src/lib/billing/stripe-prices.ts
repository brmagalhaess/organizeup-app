// Cria na Stripe o produto e o preço de uma linha do catálogo. Sem `server-only` porque o script de preços
// também usa. Só por ação explícita: o painel, num clique, ou o script, com `--gravar`.
import { stripeUnitAmount, type BillingCycle } from "@organizeup/domain";
import type Stripe from "stripe";

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

async function product(stripe: Stripe, key: string): Promise<string> {
  const found = await stripe.products.search({ query: `metadata["organizeup_item"]:"${key}"` });
  const known = found.data[0];
  if (known) return known.id;
  const name = NAMES[key];
  if (!name) throw new Error(`Item sem nome de produto: ${key}`);
  const created = await stripe.products.create({ name, metadata: { organizeup_item: key } });
  return created.id;
}

export interface CatalogLine {
  id: string;
  item: string;
  cycle: BillingCycle;
  amount: string;
  currency: string;
}

/** Id do preço. A `lookup_key` evita preço duplicado se cair no meio e repetir. */
export async function createCatalogPrice(stripe: Stripe, line: CatalogLine): Promise<string> {
  const lookup = `organizeup:${line.id}`;
  const existing = await stripe.prices.list({ lookup_keys: [lookup], limit: 1 });
  const known = existing.data[0];
  if (known) return known.id;
  const created = await stripe.prices.create({
    product: await product(stripe, productKey(line.item)),
    currency: line.currency.toLowerCase(),
    unit_amount: stripeUnitAmount(line.amount),
    recurring: { interval: line.cycle === "ano" ? "year" : "month" },
    lookup_key: lookup,
    metadata: { organizeup_item: line.item, organizeup_cycle: line.cycle },
  });
  return created.id;
}
