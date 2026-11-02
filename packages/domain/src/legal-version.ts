// Versão dos textos legais: `AAAA-MM-DD.N`. Comparar como texto põe `.10` antes de `.3`.

const VERSION = /^(\d{4}-\d{2}-\d{2})(?:\.(\d+))?$/;

function parts(version: string): { date: string; number: number } | null {
  const match = VERSION.exec(version);
  return match ? { date: match[1]!, number: Number(match[2] ?? 0) } : null;
}

/** Negativo, zero ou positivo, como em `sort`. Só para versões no formato certo. */
export function compareLegalVersions(a: string, b: string): number {
  const left = parts(a);
  const right = parts(b);
  if (!left || !right) throw new RangeError("versão legal fora do formato");
  return left.date === right.date
    ? left.number - right.number
    : left.date.localeCompare(right.date);
}

/** O aceite gravado cobre `minimum`? Vazio ou fora do formato não cobre: na dúvida, pede de novo. */
export function legalVersionAtLeast(version: string | null | undefined, minimum: string): boolean {
  return version != null && parts(version) !== null && compareLegalVersions(version, minimum) >= 0;
}
