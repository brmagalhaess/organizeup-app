// CPF, CNPJ e o documento da conta (ADR-0021). Só contas: nenhuma função aqui guarda ou registra nada.
//
// CNPJ alfanumérico: a Receita Federal atribui a novas inscrições desde julho de 2026 (IN RFB 2.229/2024). São
// 14 posições: as 12 primeiras com algarismos ou letras maiúsculas e as 2 últimas sempre algarismos. O dígito
// verificador segue no módulo 11, e cada caractere vale o código ASCII menos 48, então A = 17 e o CNPJ só de
// números dá o mesmo dígito de sempre. Fonte: Receita Federal, "Cálculo do DV do CNPJ Alfanumérico", e Serpro,
// "Cálculo dos dígitos verificadores de CNPJ alfanumérico". O exemplo oficial, 12.ABC.345/01DE-35, está no teste.

const PUNCTUATION = /[\s./-]/g;

/** Tira pontos, traços, barra e espaços. Letra minúscula de CNPJ vira maiúscula. */
const compact = (input: string) => input.replace(PUNCTUATION, "").toUpperCase();

/** Módulo 11 da Receita: pesos de 2 a `maxWeight`, da direita para a esquerda. */
function checkDigit(values: number[], maxWeight: number): number {
  let weight = 2;
  let sum = 0;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    sum += values[index]! * weight;
    weight = weight === maxWeight ? 2 : weight + 1;
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/** Os dois dígitos verificadores de um CPF, a partir dos 9 primeiros. */
export function cpfCheckDigits(base: string): string {
  const values = [...base].map(Number);
  const first = checkDigit(values, 11);
  return `${first}${checkDigit([...values, first], 11)}`;
}

/** Os dois dígitos verificadores de um CNPJ, a partir dos 12 primeiros. */
export function cnpjCheckDigits(base: string): string {
  const values = [...base].map((char) => char.charCodeAt(0) - 48);
  const first = checkDigit(values, 9);
  return `${first}${checkDigit([...values, first], 9)}`;
}

/** Número repetido, como 111.111.111-11, fecha a conta e não é documento. */
const repeated = (value: string) => [...value].every((char) => char === value[0]);

/** CPF só com os 11 algarismos, ou null se não for válido. Aceita com ou sem pontuação. */
export function normalizeCpf(input: string): string | null {
  const value = compact(input);
  if (!/^[0-9]{11}$/.test(value) || repeated(value)) return null;
  return cpfCheckDigits(value.slice(0, 9)) === value.slice(9) ? value : null;
}

/** CNPJ com os 14 caracteres, ou null se não for válido. Aceita numérico e alfanumérico. */
export function normalizeCnpj(input: string): string | null {
  const value = compact(input);
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(value) || repeated(value)) return null;
  return cnpjCheckDigits(value.slice(0, 12)) === value.slice(12) ? value : null;
}

export const isValidCpf = (input: string) => normalizeCpf(input) !== null;
export const isValidCnpj = (input: string) => normalizeCnpj(input) !== null;

/** `123.456.789-09`. Recebe o valor já normalizado. */
export const formatCpf = (cpf: string) =>
  `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;

/** `12.ABC.345/01DE-35`. Recebe o valor já normalizado. */
export const formatCnpj = (cnpj: string) =>
  `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;

/** `***.456.789-**`, para mostrar em tela. Recebe o valor já normalizado. */
export const maskCpf = (cpf: string) => `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`;

/** `**.ABC.345/01DE-**`, para mostrar em tela. Recebe o valor já normalizado. */
export const maskCnpj = (cnpj: string) =>
  `**.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-**`;

export const PERSON_TYPES = ["pf", "pj"] as const;
export type PersonType = (typeof PERSON_TYPES)[number];

export const COMPANY_NAME_MAX = 150;

/** O que a pessoa informa: mora fora, pessoa física ou empresa com responsável. */
export type Identity =
  | { inBrazil: false; personType: null; cpf: null; cnpj: null; companyName: null }
  | { inBrazil: true; personType: "pf"; cpf: string; cnpj: null; companyName: null }
  | { inBrazil: true; personType: "pj"; cpf: string; cnpj: string; companyName: string };

/** Campo com problema. Os valores digitados nunca voltam, nem em erro. */
export type IdentityField = "choice" | "cpf" | "cnpj" | "companyName";

export type IdentityResult = { ok: true; value: Identity } | { ok: false; fields: IdentityField[] };

const text = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * Confere o que veio do formulário. É a mesma regra no navegador e no servidor. Fora do Brasil não há
 * documento, e o que vier junto é ignorado: nada é guardado sem necessidade.
 */
export function parseIdentity(raw: unknown): IdentityResult {
  if (typeof raw !== "object" || raw === null) return { ok: false, fields: ["choice"] };
  const { inBrazil, personType, cpf, cnpj, companyName } = raw as Record<string, unknown>;
  if (inBrazil === false) {
    return {
      ok: true,
      value: { inBrazil: false, personType: null, cpf: null, cnpj: null, companyName: null },
    };
  }
  if (inBrazil !== true || (personType !== "pf" && personType !== "pj")) {
    return { ok: false, fields: ["choice"] };
  }

  const validCpf = normalizeCpf(text(cpf));
  if (personType === "pf") {
    if (!validCpf) return { ok: false, fields: ["cpf"] };
    return {
      ok: true,
      value: { inBrazil: true, personType: "pf", cpf: validCpf, cnpj: null, companyName: null },
    };
  }

  const validCnpj = normalizeCnpj(text(cnpj));
  const name = text(companyName).trim().replace(/\s+/g, " ");
  const validName = name.length >= 2 && name.length <= COMPANY_NAME_MAX;
  if (validCpf && validCnpj && validName) {
    return {
      ok: true,
      value: {
        inBrazil: true,
        personType: "pj",
        cpf: validCpf,
        cnpj: validCnpj,
        companyName: name,
      },
    };
  }
  const fields: IdentityField[] = [];
  if (!validCnpj) fields.push("cnpj");
  if (!validName) fields.push("companyName");
  if (!validCpf) fields.push("cpf");
  return { ok: false, fields };
}

/** Quem entra por convite é sempre pessoa, seja o que vier no formulário. Outro país continua valendo. */
export function parseInviteeIdentity(raw: unknown): IdentityResult {
  const { inBrazil, cpf } = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  return parseIdentity({ inBrazil, cpf, personType: "pf" });
}

// ---------- Achar documento em texto livre ----------
//
// Descrição de extrato e mensagem digitada trazem CPF e CNPJ de todo jeito: com barra, travessão, espaço,
// caractere invisível, dígito de outro alfabeto, colado em letra. Então a busca não olha a pontuação: anda por uma
// cópia só com letras e dígitos e confere o dígito verificador de cada janela de 11 e de 14 posições. O que evita
// falso positivo são as fronteiras: a janela não começa nem termina no meio de uma sequência de dígitos, não cruza
// valor em dinheiro, data ou UUID, e o alfanumérico não vale dentro de um código longo.

export type DocumentKind = "cpf" | "cnpj";

export interface DocumentSpan {
  kind: DocumentKind;
  start: number;
  end: number;
}

const SEPARATOR = /[\p{Zs}\p{Pd}\p{Cf}._,/\\·•]/u;
const INVISIBLE = /\p{Cf}/u;
const UNICODE_DIGIT = /\p{Nd}/u;
/** "123 . 456 . 789 - 09" tem três caracteres entre os blocos. Mais que isso, já é outra coisa. */
const MAX_GAP = 3;
/** Sigla colada no CNPJ cabe aqui; código de transação, com 20 ou mais, não. */
const MAX_GLUED_RUN = 20;

const PROTECTED = [
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  /(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/g,
  /(?<!\d)\d{2}\/\d{2}\/\d{4}(?!\d)/g,
  // Dinheiro não começa com zero: "0001.81" é o fim de um CNPJ.
  // Colado em letra também não é dinheiro: "60.00W" é pedaço de um CNPJ alfanumérico.
  /(?<![\dA-Za-z.,])(?:0|[1-9]\d{0,2}(?:\.\d{3})+|[1-9]\d*),\d{2}(?![\dA-Za-z])/g,
  /(?<![\dA-Za-z.,])(?:0|[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d*)\.\d{2}(?![\dA-Za-z])/g,
];

interface Mark {
  char: string;
  start: number;
  end: number;
  digit: boolean;
  /** Sem separador visível antes dele. */
  glued: boolean;
}

function digitOf(char: string): string | null {
  if (!UNICODE_DIGIT.test(char)) return null;
  const folded = char.normalize("NFKC");
  if (/^[0-9]$/.test(folded)) return folded;
  // Outros alfabetos: os dígitos vêm em blocos contíguos, do 0 ao 9.
  let code = char.codePointAt(0)!;
  let value = 0;
  while (value < 9 && UNICODE_DIGIT.test(String.fromCodePoint(code - 1))) {
    code -= 1;
    value += 1;
  }
  return String(value);
}

function letterOf(char: string): string | null {
  const folded = char.normalize("NFKC").toUpperCase();
  return /^[A-Z]$/.test(folded) ? folded : null;
}

/** Trechos de letras e dígitos, cada um com a posição no texto original. */
function segmentsOf(text: string): Mark[][] {
  const segments: Mark[][] = [];
  let current: Mark[] = [];
  let gap = 0;
  const flush = () => {
    if (current.length > 0) segments.push(current);
    current = [];
    gap = 0;
  };
  for (const match of text.matchAll(/[\s\S]/gu)) {
    const char = match[0];
    const value = digitOf(char) ?? letterOf(char);
    if (value) {
      current.push({
        char: value,
        start: match.index,
        end: match.index + char.length,
        digit: value >= "0" && value <= "9",
        glued: gap === 0,
      });
      gap = 0;
    } else if (!SEPARATOR.test(char)) {
      flush();
    } else if (!INVISIBLE.test(char)) {
      gap += 1;
      if (gap > MAX_GAP) flush();
    }
  }
  flush();
  return segments;
}

function protectedSpans(text: string): Array<{ start: number; end: number }> {
  return PROTECTED.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
    })),
  );
}

/** Tamanho da sequência sem separador em volta da janela. */
function gluedRun(marks: Mark[], first: number, last: number): number {
  let from = first;
  while (from > 0 && marks[from]!.glued) from -= 1;
  let to = last;
  while (to + 1 < marks.length && marks[to + 1]!.glued) to += 1;
  return to - from + 1;
}

/** CNPJ com letra concorre com palavras comuns: pede dígitos na base e não vale dentro de código longo. */
function plausibleAlphanumeric(marks: Mark[], first: number, last: number): boolean {
  const window = marks.slice(first, last + 1);
  const digits = window.slice(0, 12).filter((mark) => mark.digit).length;
  const breaks = window.flatMap((mark, index) => (index > 0 && !mark.glued ? [index] : []));
  // Na máscara da Receita, os blocos já dizem o que é.
  if (breaks.join() === "2,5,8,12") return true;
  const spaced = breaks.length > 0;
  if (spaced) return digits >= 4;
  return digits >= 2 && gluedRun(marks, first, last) <= MAX_GLUED_RUN;
}

function kindOf(marks: Mark[], first: number, last: number): DocumentKind | null {
  const window = marks.slice(first, last + 1);
  const value = window.map((mark) => mark.char).join("");
  if (window.length === 11) return normalizeCpf(value) ? "cpf" : null;
  if (!normalizeCnpj(value)) return null;
  return window.every((mark) => mark.digit) || plausibleAlphanumeric(marks, first, last)
    ? "cnpj"
    : null;
}

/** Todo CPF e CNPJ do texto, com a posição no original. */
export function findDocuments(text: string): DocumentSpan[] {
  // Até o CNPJ com mais letras tem os dois dígitos verificadores.
  if ((text.match(/\p{Nd}/gu)?.length ?? 0) < 2) return [];
  const spared = protectedSpans(text);
  const crossesProtected = (start: number, end: number) =>
    spared.some(
      (span) => span.start < end && start < span.end && !(span.start === start && span.end === end),
    );
  const found: DocumentSpan[] = [];
  for (const marks of segmentsOf(text)) {
    const insideDigits = (index: number) =>
      index > 0 && index < marks.length && marks[index]!.glued && marks[index]!.digit
        ? marks[index - 1]!.digit
        : false;
    let first = 0;
    while (first < marks.length) {
      let matched = 0;
      if (!insideDigits(first)) {
        for (const size of [14, 11]) {
          const last = first + size - 1;
          if (last >= marks.length || insideDigits(last + 1)) continue;
          const kind = kindOf(marks, first, last);
          const start = marks[first]!.start;
          const end = marks[last]!.end;
          if (kind && !crossesProtected(start, end)) {
            found.push({ kind, start, end });
            matched = size;
            break;
          }
        }
      }
      first += matched || 1;
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

/** Troca cada documento do texto por `mark`. */
export function maskDocuments(text: string, mark: string): string {
  let out = "";
  let from = 0;
  for (const { start, end } of findDocuments(text)) {
    out += text.slice(from, start) + mark;
    from = end;
  }
  return out + text.slice(from);
}

/**
 * Para texto de arquivo, onde o documento vem partido por coluna ou linha: tabulação, quebra de linha e
 * dois-pontos também separam. Mesmo tamanho de texto, então as posições valem no original.
 */
export function maskDocumentsLoose(text: string, mark: string): string {
  const flat = text.replace(/[\t\r\n:]/g, " ");
  let out = "";
  let from = 0;
  for (const { start, end } of findDocuments(flat)) {
    out += text.slice(from, start) + mark;
    from = end;
  }
  return out + text.slice(from);
}

/** Tipo da conta, gravado no tenant: pessoa física tem família; pessoa jurídica tem sócios. */
export const ACCOUNT_TYPES = PERSON_TYPES;
export type AccountType = PersonType;

export interface AccountFeatures {
  /** Parentesco nas pessoas: cônjuge, filhos. */
  relations: boolean;
  /** Data do casamento, no calendário e nas viagens. */
  wedding: boolean;
  /** Dependentes de IR na renda. */
  dependents: boolean;
  /** Percentual de participação, só informativo. */
  ownership: boolean;
  /** Quem entra por convite informa o próprio CPF ao aceitar. */
  inviteAsksCpf: boolean;
}

const FEATURES: Record<AccountType, AccountFeatures> = {
  pf: {
    relations: true,
    wedding: true,
    dependents: true,
    ownership: false,
    inviteAsksCpf: false,
  },
  pj: {
    relations: false,
    wedding: false,
    dependents: false,
    ownership: true,
    inviteAsksCpf: true,
  },
};

/** Uma pergunta só para o que muda entre família e empresa: as telas não olham o tipo direto. */
export const accountFeatures = (type: AccountType): AccountFeatures => FEATURES[type];
