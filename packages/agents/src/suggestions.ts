// Payloads das sugestões dos agentes (household_suggestions.payload) e as chaves de dedupe.
// Os schemas valem nas duas pontas: o agente grava e `applySuggestion` revalida antes de aplicar
// (regra 7 reescrita, ADR-0015). Dinheiro sempre como string "1234.56".
import { z } from "zod";
import type { SuggestionKind } from "@organizeup/db";

/** Valor em reais no formato do banco, maior que zero. */
export const amountSchema = z
  .string()
  .regex(/^\d+\.\d{2}$/, "Valor no formato 1234.56.")
  .refine((value) => value !== "0.00", "Valor maior que zero.");
/** Valor em reais no formato do banco, zero permitido. */
export const nonNegativeAmountSchema = z
  .string()
  .regex(/^\d+\.\d{2}$/, "Valor no formato 1234.56.");
export const yearMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês no formato AAAA-MM.");
export const kindSchema = z.enum(["receita", "despesa"]);
export const categorySourceSchema = z.enum(["familia", "importacao", "revisar", "agente"]);

export const categoriaPayloadSchema = z.object({
  /** Tipo dos lançamentos (receita ou despesa); define a memória do estabelecimento. */
  kind: kindSchema,
  transactionIds: z.array(z.string().min(1)).min(1),
  fromCategoryId: z.string().min(1),
  toCategoryId: z.string().min(1).nullable(),
  newCategory: z.object({ name: z.string().min(1).max(60), essential: z.boolean() }).nullable(),
  merchant: z.string().max(120),
  reason: z.string().max(200).optional(),
  /** Estado anterior, preenchido ao aplicar (automático ou pela família), para desfazer. */
  previous: z
    .array(
      z.object({
        transactionId: z.string().min(1),
        categoryId: z.string().min(1),
        categorySource: categorySourceSchema.nullable(),
      }),
    )
    .optional(),
  /** Categoria em que os lançamentos ficaram (resolvida ao aplicar, inclusive a criada). */
  appliedCategoryId: z.string().min(1).optional(),
});

export const fusaoCategoriaPayloadSchema = z.object({
  fromCategoryId: z.string().min(1),
  toCategoryId: z.string().min(1),
  transactionIds: z.array(z.string().min(1)),
  planIds: z.array(z.string().min(1)),
  purchaseIds: z.array(z.string().min(1)),
  reason: z.string().max(200).optional(),
  /** Preenchido ao aplicar: o que foi movido de fato, para desfazer. */
  moved: z
    .object({
      transactionIds: z.array(z.string()),
      planIds: z.array(z.string()),
      purchaseIds: z.array(z.string()),
      incomeSourceIds: z.array(z.string()),
      memoryMerchants: z.array(z.object({ kind: kindSchema, merchant: z.string() })),
    })
    .optional(),
});

export const aporteReservaPayloadSchema = z.object({
  monthlyAmount: amountSchema,
  previous: nonNegativeAmountSchema.nullable(),
});

export const aporteDividaPayloadSchema = z.object({
  debtId: z.string().min(1),
  extraMonthly: amountSchema,
});

export const aporteInvestimentoPayloadSchema = z.object({
  monthlyAmount: amountSchema,
  previous: nonNegativeAmountSchema.nullable(),
});

export const tripEstimateSchema = z.object({
  passagem: nonNegativeAmountSchema,
  hospedagem: nonNegativeAmountSchema,
  alimentacao: nonNegativeAmountSchema,
  transporte: nonNegativeAmountSchema,
});

export const viagemPayloadSchema = z.object({
  destinationId: z.string().min(1),
  name: z.string().min(1).max(80),
  month: yearMonthSchema,
  days: z.number().int().min(1).max(60),
  personIds: z.array(z.string().min(1)).min(1),
  estimated: tripEstimateSchema,
  total: nonNegativeAmountSchema,
  perPerson: nonNegativeAmountSchema.optional(),
  monthlyToSave: nonNegativeAmountSchema,
  fits: z.boolean(),
  confidence: z.enum(["baixa", "media"]),
  source: z.string().max(600),
  /** Preenchidos ao aplicar, para desfazer. */
  tripId: z.string().optional(),
  eventId: z.string().optional(),
});

export const metaPayloadSchema = z.object({
  goalId: z.string().min(1),
  /** Nova data desejada proposta (fim do plano que cabe). Null quando não há plano. */
  proposedMonth: yearMonthSchema.nullable(),
  /** Quanto a mais por mês fecharia na data desejada. Null sem data. */
  extraMonthly: amountSchema.nullable(),
  /** Data desejada anterior, preenchida ao aplicar, para desfazer. */
  previousDesiredMonth: yearMonthSchema.nullable().optional(),
  /** Meta nova em rascunho, proposta pelo assistente. `goalId` só vale depois de aplicar. */
  draft: z
    .object({
      name: z.string().min(1).max(80),
      targetAmount: amountSchema,
      desiredMonth: yearMonthSchema.nullable(),
    })
    .optional(),
});

export const linkPayloadSchema = z.object({
  href: z.string().min(1).max(200),
  investmentId: z.string().min(1).optional(),
});

const priceSourceSchema = z.enum(["familia", "mercado"]);
const dividendKindSchema = z.enum(["dividendo", "jcp", "rendimento"]);
const proventoRefSchema = z.object({
  investmentId: z.string().min(1),
  marketDividendId: z.string().min(1),
});

/** O que a atualização automática de um dia mudou, com o estado anterior, para desfazer (ADR-0017). */
export const marketChangesSchema = z.object({
  prices: z.array(
    z.object({
      investmentId: z.string().min(1),
      quoteDate: z.string().min(1),
      price: z.string().min(1),
      previous: z.object({
        price: z.string().nullable(),
        valuedOn: z.string().nullable(),
        source: priceSourceSchema,
      }),
    }),
  ),
  created: z.array(proventoRefSchema.extend({ dividendId: z.string().min(1) })),
  adjusted: z.array(
    proventoRefSchema.extend({
      dividendId: z.string().min(1),
      gross: amountSchema,
      withheld: nonNegativeAmountSchema,
      previous: z.object({ gross: amountSchema, withheld: nonNegativeAmountSchema }),
    }),
  ),
  removed: z.array(
    proventoRefSchema.extend({
      kind: dividendKindSchema,
      paidOn: z.string().min(1),
      gross: amountSchema,
      withheld: nonNegativeAmountSchema,
    }),
  ),
});

/** Evento em ações aplicado a um investimento, com a quantidade de antes e a de depois. */
export const stockEventChangeSchema = z.object({
  investmentId: z.string().min(1),
  comDate: z.string().min(1),
  factor: z.string().min(1),
  note: z.string().min(1).max(120),
  quantityBefore: z.string().min(1),
  quantityAfter: z.string().min(1),
});

/** Aviso com link. A atualização do dia acrescenta `market`; o ajuste de quantidade, `stockEvent`. */
export const investimentoPayloadSchema = linkPayloadSchema.extend({
  market: marketChangesSchema.optional(),
  stockEvent: stockEventChangeSchema.optional(),
});

export const SUGGESTION_PAYLOADS = {
  categoria: categoriaPayloadSchema,
  fusao_categoria: fusaoCategoriaPayloadSchema,
  aporte_reserva: aporteReservaPayloadSchema,
  aporte_divida: aporteDividaPayloadSchema,
  aporte_investimento: aporteInvestimentoPayloadSchema,
  viagem: viagemPayloadSchema,
  meta: metaPayloadSchema,
  investimento: investimentoPayloadSchema,
  lembrete: linkPayloadSchema,
} as const satisfies Record<SuggestionKind, z.ZodType>;

export type CategoriaPayload = z.infer<typeof categoriaPayloadSchema>;
export type FusaoCategoriaPayload = z.infer<typeof fusaoCategoriaPayloadSchema>;
export type AporteReservaPayload = z.infer<typeof aporteReservaPayloadSchema>;
export type AporteDividaPayload = z.infer<typeof aporteDividaPayloadSchema>;
export type AporteInvestimentoPayload = z.infer<typeof aporteInvestimentoPayloadSchema>;
export type ViagemPayload = z.infer<typeof viagemPayloadSchema>;
export type MetaPayload = z.infer<typeof metaPayloadSchema>;
export type LinkPayload = z.infer<typeof linkPayloadSchema>;
export type MarketChanges = z.infer<typeof marketChangesSchema>;
export type StockEventChange = z.infer<typeof stockEventChangeSchema>;
export type InvestimentoPayload = z.infer<typeof investimentoPayloadSchema>;

export type SuggestionPayload = {
  categoria: CategoriaPayload;
  fusao_categoria: FusaoCategoriaPayload;
  aporte_reserva: AporteReservaPayload;
  aporte_divida: AporteDividaPayload;
  aporte_investimento: AporteInvestimentoPayload;
  viagem: ViagemPayload;
  meta: MetaPayload;
  investimento: InvestimentoPayload;
  lembrete: LinkPayload;
};

/** Valida o payload gravado para o tipo. Lança ZodError se não bater (dado corrompido). */
export function parsePayload<K extends SuggestionKind>(
  kind: K,
  payload: unknown,
): SuggestionPayload[K] {
  return SUGGESTION_PAYLOADS[kind].parse(payload) as SuggestionPayload[K];
}

export const MARKET_DEDUPE_PREFIX = "mercado:";
export const STOCK_EVENT_DEDUPE_PREFIX = "investimento:acoes:";

/** Chaves de dedupe: uma pendente por chave (índice parcial `household_suggestions_pending_dedupe`). */
export const DEDUPE = {
  categoria: (kind: "receita" | "despesa", merchant: string, to: string | { newName: string }) =>
    `categoria:${kind}:${merchant}:${typeof to === "string" ? to : `new:${to.newName}`}`,
  fusao: (fromCategoryId: string, toCategoryId: string) =>
    `fusao:${fromCategoryId}:${toCategoryId}`,
  aporteReserva: (month: string) => `aporte_reserva:${month}`,
  aporteDivida: (debtId: string, month: string) => `aporte_divida:${debtId}:${month}`,
  aporteInvestimento: (month: string) => `aporte_investimento:${month}`,
  viagem: (destinationId: string, year: number | string) => `viagem:${destinationId}:${year}`,
  meta: (goalId: string, month: string) => `meta:${goalId}:${month}`,
  metaNova: (name: string) => `meta:nova:${name}`,
  investimentoPreco: (investmentId: string, month: string) =>
    `investimento:preco:${investmentId}:${month}`,
  investimentoClasse: (assetClass: string, month: string) =>
    `investimento:classe:${assetClass}:${month}`,
  lembreteAposentadoria: () => "lembrete:aposentadoria",
  /** Desdobramento, grupamento ou bonificação: o aviso sai uma vez por evento. */
  investimentoEvento: (investmentId: string, eventOn: string) =>
    `investimento:evento:${investmentId}:${eventOn}`,
  /** Quantidade ajustada por evento em ações. A nota vai cortada: a chave tem até 160 caracteres. */
  investimentoAcoes: (investmentId: string, comDate: string, note: string) =>
    `${STOCK_EVENT_DEDUPE_PREFIX}${investmentId}:${comDate}:${note.slice(0, 80)}`,
  investimentoConferir: (month: string) => `investimento:conferir:${month}`,
  /** Uma alteração automática de cotações e proventos por dia. */
  mercadoDia: (day: string) => `${MARKET_DEDUPE_PREFIX}dia:${day}`,
  /** Marca de provento automático excluído pela família. */
  mercadoProvento: (investmentId: string, marketDividendId: string) =>
    `${MARKET_DEDUPE_PREFIX}provento:${investmentId}:${marketDividendId}`,
} as const;
