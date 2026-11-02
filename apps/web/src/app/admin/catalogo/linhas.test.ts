import { readFileSync } from "node:fs";
import path from "node:path";
import type { AdminCatalogRow } from "@organizeup/db";
import { describe, expect, it } from "vitest";
import { kindOf, linesOf, SECTIONS } from "./linhas";

const migration = path.resolve(
  import.meta.dirname,
  "../../../../../../packages/db/migrations/0036_planos_assinatura.sql",
);
const seeded = [
  ...readFileSync(migration, "utf8").matchAll(/\('([a-z_]+(?::\w+)?)', '(?:mes|ano)'/g),
]
  .map((match) => match[1]!)
  .filter((item) => item !== "mes");

const row = (over: Partial<AdminCatalogRow>) =>
  ({
    id: "a",
    item: "base:50",
    cycle: "mes",
    amount: "9.90",
    onSale: false,
    ...over,
  }) as AdminCatalogRow;

describe("seções do catálogo", () => {
  it("todo item vendido aparece em alguma seção", () => {
    expect(seeded).toContain("familia_mensagens:300");
    expect(seeded.length).toBeGreaterThan(20);
    const kinds = SECTIONS.flatMap((section) => section.kinds);
    expect(seeded.filter((item) => !kinds.includes(kindOf(item)))).toEqual([]);
  });
});

describe("linhas", () => {
  it("mostra a que está à venda, com as antigas guardadas", () => {
    const [line] = linesOf([row({ id: "novo", onSale: true }), row({ id: "velho" })]);
    expect(line?.current.id).toBe("novo");
    expect(line?.older.map((item) => item.id)).toEqual(["velho"]);
  });
});
