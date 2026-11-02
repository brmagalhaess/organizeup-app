// A lista mostra a fatura inteira: as compras dela só aparecem aqui, e o filtro escolhe quais.
interface Line {
  categoryId: string;
}

/** Por categoria, as compras dela. Em "Aportes", as compras de aporte, que a fatura esconde. */
export function cardLinesInFilter<T extends Line>(
  lines: T[],
  filter: { category: string; kind: string },
  savingCategoryIds: string[],
): T[] {
  if (filter.category) return lines.filter((line) => line.categoryId === filter.category);
  if (filter.kind !== "aporte") return [];
  return lines.filter((line) => savingCategoryIds.includes(line.categoryId));
}
