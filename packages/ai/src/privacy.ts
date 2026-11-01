// O que sai para o modelo (§0 da especificação). Pessoas viram "titular", "cônjuge", "filho 1";
// nome, e-mail e CPF não saem. Toda saída de ferramenta e toda pergunta passam por aqui.
import { asc, eq, household, householdMember, people, user, type TenantTx } from "@organizeup/db";

const RELATION_LABELS: Record<string, string> = {
  titular: "titular",
  conjuge: "cônjuge",
  filho: "filho",
  pai_mae: "pai ou mãe",
  outro: "outra pessoa",
};

interface PersonRow {
  id: string;
  name: string;
  relation: string;
}

/** Rótulo de cada pessoa, na ordem de cadastro. Titular e cônjuge não numeram se forem únicos. */
export function personLabels(rows: Array<Omit<PersonRow, "name">>): Map<string, string> {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.relation, (totals.get(row.relation) ?? 0) + 1);
  const seen = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const row of rows) {
    const number = (seen.get(row.relation) ?? 0) + 1;
    seen.set(row.relation, number);
    const base = RELATION_LABELS[row.relation] ?? "outra pessoa";
    const numbered = row.relation === "filho" || (totals.get(row.relation) ?? 0) > 1;
    labels.set(row.id, numbered ? `${base} ${number}` : base);
  }
  return labels;
}

export async function loadPeopleLabels(tx: TenantTx): Promise<Map<string, string>> {
  const rows = await tx
    .select({ id: people.id, relation: people.relation })
    .from(people)
    .orderBy(asc(people.createdAt));
  return personLabels(rows);
}

const ACCENTS: Record<string, string> = {
  a: "aáàâãä",
  c: "cç",
  e: "eéèêë",
  i: "iíìîï",
  n: "nñ",
  o: "oóòôõö",
  u: "uúùûü",
};

const strip = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Casa a palavra com ou sem acento. */
function looseWord(word: string): string {
  return [...strip(word)]
    .map((char) => {
      const group = ACCENTS[char];
      return group ? `[${group}]` : char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
}

/** Partículas e palavras que aparecem em nome de família, mas não identificam ninguém. */
const NOT_A_NAME = new Set([
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "familia",
  "casa",
  "minha",
  "nossa",
]);

const EMAIL = /[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+/g;
const CPF = /(?<![\d.])\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}(?![\d.])/g;
const NUMERIC = /^-?\d+(\.\d+)?$/;

export interface PrivacyEntry {
  /** Nome como está no cadastro. */
  name: string;
  label: string;
}

export interface PrivacyFilter {
  scrub(text: string): string;
  /** Limpa todo texto de um objeto. Números e valores em string passam intactos. */
  scrubDeep<T>(value: T): T;
}

export function createPrivacyFilter(entries: PrivacyEntry[]): PrivacyFilter {
  // Parte que aparece em mais de uma pessoa (o sobrenome) vira "família".
  const labels = new Map<string, string>();
  for (const { name, label } of entries) {
    const parts = strip(name)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((part) => part.length >= 3 && !NOT_A_NAME.has(part));
    for (const part of parts) {
      const current = labels.get(part);
      labels.set(part, current === undefined || current === label ? label : "família");
    }
  }
  const parts = [...labels.keys()].sort((a, b) => b.length - a.length);
  const pattern =
    parts.length === 0
      ? null
      : new RegExp(
          `(?<![\\p{L}\\p{N}])(?:${parts.map(looseWord).join("|")})(?![\\p{L}\\p{N}])`,
          "giu",
        );

  const scrub = (text: string) => {
    const masked = text.replace(EMAIL, "[e-mail]").replace(CPF, "[documento]");
    return pattern
      ? masked.replace(pattern, (found) => labels.get(strip(found)) ?? "pessoa")
      : masked;
  };

  const scrubDeep = <T>(value: T): T => {
    if (typeof value === "string") {
      return (NUMERIC.test(value) ? value : scrub(value)) as T;
    }
    if (Array.isArray(value)) return value.map((item) => scrubDeep(item)) as T;
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, scrubDeep(item)]),
      ) as T;
    }
    return value;
  };

  return { scrub, scrubDeep };
}

/** Nomes de quem é da família: pessoas cadastradas, contas de membros e o nome da família. */
export async function loadPrivacyFilter(tx: TenantTx, householdId: string): Promise<PrivacyFilter> {
  const rows = await tx
    .select({ id: people.id, name: people.name, relation: people.relation })
    .from(people)
    .orderBy(asc(people.createdAt));
  const labels = personLabels(rows);
  const members = await tx
    .select({ name: user.name })
    .from(householdMember)
    .innerJoin(user, eq(user.id, householdMember.userId))
    .where(eq(householdMember.organizationId, householdId));
  const [family] = await tx
    .select({ name: household.name })
    .from(household)
    .where(eq(household.id, householdId));
  return createPrivacyFilter([
    ...rows.map((row) => ({ name: row.name, label: labels.get(row.id)! })),
    ...members.map((member) => ({ name: member.name, label: "pessoa da família" })),
    ...(family ? [{ name: family.name, label: "família" }] : []),
  ]);
}

/** Texto digitado pela família ou vindo de extrato: dado, nunca instrução. */
export const untrusted = (text: string | null | undefined, max = 120) =>
  text ? { dado_nao_confiavel: text.slice(0, max) } : null;
