// Como o catálogo se organiza na tela: uma linha por item e ciclo, dentro de uma seção. Item sem seção sumiria da
// tela sem aviso, e por isso o teste confere todos os da migração.
import type { AdminCatalogRow } from "@organizeup/db";
import { CONNECTED_ITEM } from "@organizeup/domain";

export interface CatalogSection {
  title: string;
  description: string;
  /** Tipo do item: a parte antes do `:`. */
  kinds: string[];
}

export const SECTIONS: CatalogSection[] = [
  {
    title: "Família completa",
    description: "O pacote que já vem marcado, e as mensagens a mais em cima dele.",
    kinds: ["familia", "familia_mensagens"],
  },
  { title: "Base", description: "Degraus de lançamentos por mês.", kinds: ["base"] },
  { title: "Módulos", description: "O que a família liga e desliga.", kinds: ["modulo"] },
  { title: "Assistente", description: "Degraus de mensagens por mês.", kinds: ["assistente"] },
  { title: "Moedas", description: "Cada moeda além da principal.", kinds: ["moeda"] },
  {
    title: "Contas conectadas",
    description:
      "Bloqueado: não vai à venda enquanto a conexão com bancos não existir. Só mensal, sem preço anual.",
    kinds: [CONNECTED_ITEM],
  },
];

export const kindOf = (item: string) => item.split(":")[0] ?? item;

export interface CatalogLine {
  current: AdminCatalogRow;
  older: AdminCatalogRow[];
}

/** Uma linha por item e ciclo: a que está à venda, ou a mais nova, com as antigas guardadas. */
export function linesOf(rows: readonly AdminCatalogRow[]): CatalogLine[] {
  const groups = new Map<string, AdminCatalogRow[]>();
  for (const row of rows) {
    const key = `${row.item}|${row.cycle}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].map((group) => {
    const current = group.find((row) => row.onSale) ?? group[0]!;
    return { current, older: group.filter((row) => row !== current) };
  });
}

export const sectionLines = (section: CatalogSection, lines: readonly CatalogLine[]) =>
  lines.filter(({ current }) => section.kinds.includes(kindOf(current.item)));
