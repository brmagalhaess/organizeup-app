// Verificação determinística da resposta (§0): todo valor em dinheiro, em reais, dólar ou euro, precisa
// ter vindo de uma ferramenta ou da pergunta. A resposta sai em tempo real, então o que não confere não some: a tela
// avisa para conferir. O verificador completo, que reprova antes de gravar, é o da rotina noturna.

// Número em qualquer dos dois formatos: "1.234,56" em português e espanhol, "1,234.56" em inglês.
const AMOUNT = String.raw`\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
// "mil" vem por último: é prefixo de "million" e "millones".
const UNIT = String.raw`\s?(?:milh(?:ão|ões)|mill(?:ion|ions|ón|ones)|thousand|mil|k\b)`;
const SYMBOL = String.raw`(?:R\$|US\$|\$|€)`;
const BEFORE = new RegExp(String.raw`${SYMBOL}\s?(${AMOUNT})(${UNIT})?`, "gi");
/** Espanhol costuma pôr o símbolo depois: a instrução pede antes, mas a conferência não confia nisso. */
const AFTER = new RegExp(String.raw`(?<![\d.,])(${AMOUNT})(${UNIT})?\s?${SYMBOL}`, "gi");

/** Número em qualquer texto: "1234.56", "1.234,56". Só para formar o conjunto do que é conhecido. */
const ANY_NUMBER = /\d[\d.,]*\d|\d/g;

export function parseNumber(raw: string): number | null {
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  // O separador decimal é o último, seguido de 1 ou 2 dígitos. "1.234" é milhar; "1234.56" é decimal.
  const decimalAt = Math.max(lastComma, lastDot);
  const tail = decimalAt >= 0 ? raw.length - decimalAt - 1 : 0;
  const hasDecimal = decimalAt >= 0 && tail >= 1 && tail <= 2;
  const whole = (hasDecimal ? raw.slice(0, decimalAt) : raw).replace(/[.,]/g, "");
  const fraction = hasDecimal ? raw.slice(decimalAt + 1) : "";
  const value = Number(`${whole}.${fraction || 0}`);
  return Number.isFinite(value) ? value : null;
}

export function knownNumbers(texts: string[]): number[] {
  const found = new Set<number>();
  for (const text of texts) {
    for (const match of text.matchAll(ANY_NUMBER)) {
      const value = parseNumber(match[0]);
      if (value !== null) found.add(value);
    }
  }
  return [...found];
}

function moneyValues(text: string): number[] {
  return [...text.matchAll(BEFORE), ...text.matchAll(AFTER)].flatMap((match) => {
    const value = parseNumber(match[1]!);
    if (value === null) return [];
    const unit = match[2]?.trim().toLowerCase();
    if (unit === "mil" || unit === "thousand" || unit === "k") return [value * 1_000];
    return [unit ? value * 1_000_000 : value];
  });
}

/** Meio por cento ou cinquenta centavos: cobre "R$ 1.235" para 1234,56 e "R$ 1,2 mil" para 1234,56. */
const closeTo = (value: number, known: number) =>
  Math.abs(value - known) <= Math.max(0.5, Math.abs(known) * 0.05);

/** Valores em dinheiro da resposta que não vieram de lugar nenhum. */
export function uncheckedAmounts(answer: string, known: number[]): number[] {
  return moneyValues(answer).filter((value) => !known.some((item) => closeTo(value, item)));
}

const TICKER = /\b[A-Z]{4}\d{1,2}\b/;
// A resposta sai no idioma da pessoa: o aviso da CVM não pode depender de ela estar em português.
const INVESTMENT_TALK =
  /\b(investimentos?|ações|fundos? imobiliários?|fiis?|renda fixa|tesouro|cdb|etfs?|carteira|proventos?|dividendos?|investments?|stocks?|shares|reits?|real estate funds?|fixed income|treasury|bonds?|portfolio|dividends?|inversi(?:ón|ones)|acciones|fondos? inmobiliarios?|renta fija|cartera)(?![\p{L}\p{N}])/iu;

/** A resposta fala de investimento, com ou sem ferramenta: leva o aviso da CVM. */
export const mentionsInvestment = (text: string) => TICKER.test(text) || INVESTMENT_TALK.test(text);
