// Nome de lugar: a mesma comparação na busca da tela, ao gravar a intenção e na conta do agente, para
// "lisboa" digitado nunca virar um lugar diferente de Lisboa do catálogo (ADR-0026).

/** Sem acento, sem caixa, sem espaço sobrando e sem caractere invisível. */
export const normalizePlace = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[\p{M}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** O destino da tabela com este nome, de qualquer jeito que ele tenha sido escrito. */
export function destinationNamed<T extends { name: string }>(
  name: string,
  destinations: readonly T[],
): T | undefined {
  const wanted = normalizePlace(name);
  if (!wanted) return undefined;
  return destinations.find((destination) => normalizePlace(destination.name) === wanted);
}

// A tabela guarda o código ISO. O nome do país sai nos três idiomas, porque os nomes dos destinos não são
// traduzidos (ADR-0020) e quem usa o inglês pode procurar "Brasil".
const COUNTRY_NAMES = ["pt-BR", "en", "es"].map(
  (locale) => new Intl.DisplayNames([locale], { type: "region" }),
);

/** Siglas que as pessoas digitam e o nome oficial não traz. */
const COUNTRY_ALIASES: Record<string, string[]> = { US: ["eua", "usa"], GB: ["uk"] };

const countryNames = (code: string) => [
  ...COUNTRY_NAMES.map((names) => {
    try {
      return normalizePlace(names.of(code) ?? "");
    } catch {
      return "";
    }
  }),
  ...(COUNTRY_ALIASES[code] ?? []),
];

/** Busca por cidade ou por país. Menos de duas letras ainda não busca. */
export function searchDestinations<T extends { name: string; country: string }>(
  destinations: readonly T[],
  query: string,
  limit = 6,
): T[] {
  const term = normalizePlace(query);
  if (term.length < 2) return [];
  return destinations
    .filter(
      (destination) =>
        normalizePlace(destination.name).includes(term) ||
        countryNames(destination.country).some((name) => name.includes(term)),
    )
    .slice(0, limit);
}
