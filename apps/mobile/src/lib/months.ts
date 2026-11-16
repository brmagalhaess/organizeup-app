/** Mês vizinho de "AAAA-MM". */
export function addMonths(month: string, delta: number): string {
  const [year = 0, index = 1] = month.split("-").map(Number);
  const total = year * 12 + (index - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** "AAAA-MM-DD" do dia local de uma data. */
export function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Meio-dia local do dia "AAAA-MM-DD": longe da virada, o dia não muda com o fuso. */
export function fromIsoDate(date: string): Date {
  const [year = 2000, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}
