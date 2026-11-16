// A `position` das propostas é a ordem em que a família revisa o arquivo (ADR-0030), e o `insert` de
// `saveSmartReading` vai em pedaços de 200: a conta é `start + at + index`, com `index` contado dentro do
// pedaço (ORG-258). Aqui a virada do pedaço (linha 200 para 201) fica provada, com banco real, e também a
// releitura, que começa depois da maior `position` que sobrou. Dados fictícios.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { SmartProposal, SmartReading } from "@organizeup/domain";
import type { TenantContext } from "@organizeup/db";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrls: { owner: string; app: string; worker: string; admin: string };
  }
}

const urls = inject("dbUrls");
process.env.DATABASE_URL = urls.app;
process.env.ADMIN_DATABASE_URL = urls.admin;

const db = await import("@organizeup/db");
const domain = await import("@organizeup/domain");
const agents = await import("../src/index");

const FAMILY = "hh-position";
const OWNER = "user-position";
const TODAY = "2026-11-02";
let owner: TenantContext;

/** Cada proposta carrega o próprio índice no `excerpt`: assim a conferência vê par a par, não só o conjunto. */
const proposalsOf = (count: number): SmartProposal[] =>
  Array.from({ length: count }, (_, index) => {
    const day = String((index % 28) + 1).padStart(2, "0");
    const payload = domain.buildSmartPayload(
      "lancamento",
      {
        description: `COMPRA ${index}`,
        // `buildSmartPayload` só aceita data ISO e número sem sinal nem vírgula.
        date: `2026-11-${day}`,
        amount: "10.00",
        kind: "despesa",
      },
      TODAY,
    );
    // Fixture muda de formato sem avisar: proposta pela metade não serviria de prova.
    if (payload.destination !== "lancamento" || !payload.date || !payload.amount) {
      throw new Error("fixture incompleta");
    }
    return { payload, confidence: "media", excerpt: `linha ${index}` };
  });

const readingOf = (count: number): SmartReading => ({
  docType: "extrato",
  issuer: null,
  confidence: "media",
  proposals: proposalsOf(count),
  fields: [],
  notes: [],
});

/** Lote novo com um arquivo só. O conteúdo muda por `label` porque o mesmo sha256 volta como repetido. */
async function newFile(label: string): Promise<{ importId: string; fileId: string }> {
  return db.withHousehold(owner, async (tx) => {
    const importId = (await agents.createSmartImport(tx, owner))!;
    const bytes = new TextEncoder().encode(`Data;Descrição;Valor\n01/11/2026;${label};-10,00\n`);
    const checked = domain.checkSmartFile(bytes, `${label}.csv`);
    if (!checked.ok) throw new Error(checked.code);
    const saved = await agents.saveSmartFile(tx, owner, {
      importId,
      fileName: checked.fileName,
      mediaType: checked.mediaType,
      bytes,
    });
    if (!saved.ok) throw new Error(saved.code);
    return { importId, fileId: saved.id };
  });
}

const itemsOf = (fileId: string) =>
  db.withHousehold(owner, (tx) =>
    tx
      .select({
        position: db.smartImportItems.position,
        status: db.smartImportItems.status,
        excerpt: db.smartImportItems.excerpt,
      })
      .from(db.smartImportItems)
      .where(db.eq(db.smartImportItems.fileId, fileId))
      .orderBy(db.asc(db.smartImportItems.position)),
  );

beforeAll(async () => {
  await db.withAdmin("seed da ordem do importador", async (admin) => {
    await admin
      .insert(db.user)
      .values({ id: OWNER, name: "Titular", email: `${OWNER}@example.com` });
    await admin.insert(db.household).values({ id: FAMILY, name: "Família", slug: FAMILY });
    await admin
      .insert(db.householdMember)
      .values({ id: "m-position", organizationId: FAMILY, userId: OWNER, role: "owner" });
  });
  const found = await db.fromSession({
    user: { id: OWNER },
    session: { activeOrganizationId: FAMILY },
  });
  if (!found) throw new Error("sem contexto");
  owner = found;
  await db.withHousehold(owner, async (tx) => {
    await tx.insert(db.householdSettings).values({ householdId: FAMILY });
    await db.ensureFinanceDefaults(tx, FAMILY);
  });
});

afterAll(() => db.closeAllPools());

describe("ordem das propostas do importador", () => {
  // 200 é o tamanho do pedaço do `insert`; 201 é a primeira linha do segundo pedaço, onde um erro de um
  // apareceria. 5.000 é o teto de itens por arquivo.
  for (const count of [0, 1, 200, 201, 5_000]) {
    it(`grava ${count} propostas em sequência, sem repetir nem deslocar`, async () => {
      const { importId, fileId } = await newFile(`ordem-${count}`);
      const saved = await db.withHousehold(owner, (tx) =>
        agents.saveSmartReading(tx, {
          fileId,
          importId,
          householdId: FAMILY,
          reading: readingOf(count),
          method: "regras",
          truncated: false,
        }),
      );
      expect(saved).toBe(true);

      const items = await itemsOf(fileId);
      expect(items).toHaveLength(count);
      // Sequência exata de 0 a count-1: cobre repetição (menos posições distintas) e deslocamento.
      expect(items.map((item) => item.position)).toEqual(
        Array.from({ length: count }, (_, index) => index),
      );
      expect(new Set(items.map((item) => item.position)).size).toBe(count);
      // E cada posição carrega a proposta daquela linha, não a de outro pedaço.
      expect(items.map((item) => item.excerpt)).toEqual(
        Array.from({ length: count }, (_, index) => `linha ${index}`),
      );
    }, 120_000);
  }

  it("releitura começa depois da maior position que sobrou", async () => {
    const { importId, fileId } = await newFile("releitura");
    const input = {
      fileId,
      importId,
      householdId: FAMILY,
      method: "regras" as const,
      truncated: false,
    };
    const first = await db.withHousehold(owner, (tx) =>
      agents.saveSmartReading(tx, { ...input, reading: readingOf(3) }),
    );
    expect(first).toBe(true);
    expect((await itemsOf(fileId)).map((item) => item.position)).toEqual([0, 1, 2]);

    // A família aprovou a linha do meio: ela fica, e a releitura não pode cair em cima dela.
    await db.withHousehold(owner, (tx) =>
      tx
        .update(db.smartImportItems)
        .set({ status: "gravado" })
        .where(
          db.and(db.eq(db.smartImportItems.fileId, fileId), db.eq(db.smartImportItems.position, 1)),
        ),
    );

    const again = await db.withHousehold(owner, (tx) =>
      agents.saveSmartReading(tx, { ...input, reading: readingOf(2) }),
    );
    expect(again).toBe(true);

    const items = await itemsOf(fileId);
    expect(items).toEqual([
      { position: 1, status: "gravado", excerpt: "linha 1" },
      { position: 2, status: "proposto", excerpt: "linha 0" },
      { position: 3, status: "proposto", excerpt: "linha 1" },
    ]);
  }, 120_000);
});
