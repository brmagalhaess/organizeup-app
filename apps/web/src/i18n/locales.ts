// Idiomas do produto (ADR-0020). Sem "use client" e sem servidor: as duas pontas usam.
export const LOCALES = ["pt-BR", "en", "es"] as const;
export type Locale = (typeof LOCALES)[number];

/** Padrão e fallback de tudo: texto que falta em outro idioma aparece em português. */
export const DEFAULT_LOCALE: Locale = "pt-BR";

/** Quem não entrou fica com a escolha aqui. Quem entrou guarda também na conta. */
export const LOCALE_COOKIE = "organizeup_locale";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Endereço da landing em cada idioma. */
export const LANDING_PATHS: Record<Locale, string> = { "pt-BR": "/", en: "/en", es: "/es" };

/** `/en` e `/es`: o endereço escolhe o idioma, e `proxy.ts` avisa por este cabeçalho. */
export const LANDING_LOCALE_HEADER = "x-organizeup-landing-locale";

/** Cada idioma no próprio idioma: quem não lê o atual ainda acha o seu. */
export const LOCALE_NAMES: Record<Locale, string> = {
  "pt-BR": "Português (Brasil)",
  en: "English",
  es: "Español",
};

export const isLocale = (value: unknown): value is Locale =>
  LOCALES.some((locale) => locale === value);

function supported(tag: string): Locale | null {
  const language = tag.split("-")[0]!.toLowerCase();
  if (language === "pt") return "pt-BR";
  return language === "en" || language === "es" ? language : null;
}

/** Primeiro idioma aceito do cabeçalho Accept-Language, pela ordem de preferência (RFC 9110). */
export function negotiateLocale(header: string | null | undefined): Locale {
  const wanted = (header ?? "")
    .split(",")
    .map((item, order) => {
      const [tag = "", ...params] = item.trim().split(";");
      const q = params.map((param) => /^\s*q=([\d.]+)\s*$/i.exec(param)?.[1]).find(Boolean);
      return { tag: tag.trim(), weight: q === undefined ? 1 : Number(q), order };
    })
    .filter(({ weight }) => weight > 0)
    .sort((a, b) => b.weight - a.weight || a.order - b.order);
  for (const { tag } of wanted) {
    const locale = supported(tag);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}
