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
