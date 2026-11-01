// Planilha vira texto antes de ir ao modelo: a API não recebe .xlsx. Só a primeira aba, como no
// importar extrato. `checkDebtFile` já recusou o que não é xlsx ou que descomprimido ficaria gigante.
import { readSheet } from "read-excel-file/node";

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).replace(/[\t\r\n]+/g, " ");
}

export async function spreadsheetText(content: Uint8Array): Promise<string> {
  const rows = await readSheet(Buffer.from(content));
  return rows
    .map((row) => row.map(cellText).join("\t"))
    .filter((line) => line.trim().length > 0)
    .join("\n");
}
