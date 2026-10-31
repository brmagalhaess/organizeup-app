/** Fuso padrão de um household (ver household_settings.timezone). */
export const DEFAULT_TIMEZONE = "America/Sao_Paulo";

/**
 * Data civil (YYYY-MM-DD) "hoje" no fuso do household.
 * Vencimentos e eventos de calendário são datas civis, nunca instantes UTC.
 */
export function todayIn(timezone: string = DEFAULT_TIMEZONE, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Mesma data civil em outro ano; 29/02 cai em 28/02 num ano sem esse dia. */
export function shiftYears(date: string, years: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year + years, month - 1, day));
  if (shifted.getUTCMonth() !== month - 1) shifted.setUTCDate(0);
  return shifted.toISOString().slice(0, 10);
}

/** Valida um identificador de fuso IANA. */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Idade completa (anos) a partir de mês/ano de nascimento, numa data de referência. */
export function ageFromBirth(
  birthYear: number,
  birthMonth: number,
  reference: { year: number; month: number },
): number {
  let age = reference.year - birthYear;
  if (reference.month < birthMonth) age -= 1;
  return Math.max(0, age);
}
