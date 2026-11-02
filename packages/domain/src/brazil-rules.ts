// O que só vale no Brasil (ADR-0020, Fase 6). Família com moeda principal fora do real não vê nem recebe
// cálculo baseado nessas regras: renda CLT e tabelas fiscais, INSS e FGTS no plano, IR e JCP de proventos,
// catálogo e cotação da B3, destinos de viagem em reais e FGC. Nada é apagado: a tela e o cálculo somem.
// É a única pergunta sobre isso em todo o código, para a resposta não ficar em `if` espalhado.
import type { Currency } from "./money";

export const brazilRulesApply = (currency: Currency): boolean => currency === "BRL";

/** Classes de investimento com valor informado, sem cotação automática, que valem em qualquer país. */
export const ANYWHERE_INVESTMENT_CLASSES = [
  "exterior",
  "renda_fixa",
  "fundo",
  "previdencia",
  "outro",
] as const;

/** A família pode usar esta classe? Com regras brasileiras, todas; fora delas, só as de valor informado. */
export const investmentClassAllowed = (assetClass: string, currency: Currency): boolean =>
  brazilRulesApply(currency) ||
  (ANYWHERE_INVESTMENT_CLASSES as readonly string[]).includes(assetClass);
