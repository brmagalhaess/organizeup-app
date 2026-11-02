// Server actions de intenções de viagem com a conexão da web e RLS de verdade. Só a sessão é simulada. Dados
// fictícios.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrls: { owner: string; app: string; worker: string; admin: string };
  }
}

const urls = inject("dbUrls");
process.env.DATABASE_URL = urls.app;
process.env.ADMIN_DATABASE_URL = urls.admin;

const auth = vi.hoisted(() => ({ userId: "", householdId: "" }));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({
    api: {
      getSession: async () => ({
        user: { id: auth.userId, email: "dono@example.com" },
        session: { activeOrganizationId: auth.householdId },
      }),
    },
  }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ has: () => false, set: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error("404");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { messagesFor } = await import("@/i18n/messages");
  const messages = messagesFor("pt-BR");
  return {
    getLocale: async () => "pt-BR",
    getMessages: async () => messages,
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: "pt-BR", messages, namespace } as never),
  };
});

const db = await import("@organizeup/db");
const domain = await import("@organizeup/domain");
const agents = await import("@organizeup/agents");
const { requireTenant } = await import("@/lib/session");
const actions = await import("@/app/app/(painel)/viagens/actions");
const { loadTripIntentionItems } = await import("@/lib/suggestions");
const {
  household,
  householdMember,
  householdSettings,
  householdSuggestions,
  people,
  tripIntentions,
} = db;

const stamp = randomUUID().slice(0, 8);
const family = `hh-intencoes-${stamp}`;
const owner = `u-intencoes-${stamp}`;
const today = domain.todayIn();

const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const blank = {
  id: "",
  destinationId: "",
  customName: "",
  customRegion: "",
  preferredMonth: "",
  days: "",
};
const save = (values: Partial<typeof blank>) =>
  actions.saveIntention({ ok: false, message: null }, form({ ...blank, ...values }));
const ctxNow = async () => (await requireTenant()).ctx;
const rows = async () => db.withHousehold(await ctxNow(), (tx) => tx.select().from(tripIntentions));
const pending = async () =>
  db.withHousehold(await ctxNow(), (tx) =>
    tx.select().from(householdSuggestions).where(db.eq(householdSuggestions.status, "pendente")),
  );
const runAgent = async () => {
  const ctx = await ctxNow();
  return db.withHousehold(ctx, (tx) =>
    agents.runViagensAgent(tx, {
      today,
      householdId: family,
      allocation: {
        reserve: "0.00",
        debt: "0.00",
        retirement: "0.00",
        alreadyInvesting: "0.00",
        alreadySavingForGoals: "0.00",
        reserveShort: "0.00",
        debtShort: "0.00",
        redirectable: "0.00",
        goalsBudget: "500.00",
        tripsBudget: "3000.00",
        tripsCommitted: "0.00",
        shortfall: "0.00",
        notes: [],
      },
    }),
  );
};

beforeAll(async () => {
  auth.userId = owner;
  auth.householdId = family;
  await db.withAdmin("seed das intenções de viagem", async (admin) => {
    await admin.insert(db.user).values({ id: owner, name: "D", email: `d.${stamp}@example.com` });
    await admin.insert(household).values({ id: family, name: "Família", slug: family });
    await admin
      .insert(householdMember)
      .values({ id: `m-${stamp}`, organizationId: family, userId: owner, role: "owner" });
  });
  await db.withHousehold(await ctxNow(), async (tx) => {
    await tx
      .insert(householdSettings)
      .values({ householdId: family, tripsPerYear: 1, tripDays: 5 });
    await tx
      .insert(people)
      .values({ householdId: family, name: "Titular", relation: "titular", userId: owner });
  });
});

beforeEach(async () => {
  await db.withHousehold(await ctxNow(), async (tx) => {
    await tx.delete(householdSuggestions);
    await tx.delete(tripIntentions);
  });
});

afterAll(async () => {
  await db.closeAllPools();
});

describe("nome livre igual a destino do catálogo", () => {
  it.each(["Lisboa", "  lisboa ", "LISBOA", "Lisbôa", "Lis​boa"])(
    "%j vira o destino do catálogo",
    async (customName) => {
      expect(await save({ customName, customRegion: "europa" })).toEqual({
        ok: true,
        message: null,
      });
      const [row] = await rows();
      expect(row).toMatchObject({
        destinationId: "lisboa",
        customName: null,
        customRegion: null,
      });
    },
  );

  it("não precisa de região: o catálogo já diz", async () => {
    expect((await save({ customName: "Tóquio" })).ok).toBe(true);
    expect((await rows())[0]).toMatchObject({ destinationId: "toquio" });
  });

  it("quem já tem o destino lê que ele está na lista", async () => {
    await save({ destinationId: "lisboa" });
    const repeated = await save({ customName: "LISBOA", customRegion: "europa" });
    expect(repeated).toEqual({ ok: false, message: "Este lugar já está na sua lista." });
    expect(await rows()).toHaveLength(1);
  });

  it("nome livre antigo igual ao catálogo também conta como repetido", async () => {
    await db.withHousehold(await ctxNow(), (tx) =>
      tx
        .insert(tripIntentions)
        .values({ householdId: family, customName: "Lisboa", customRegion: "europa" }),
    );
    expect((await save({ destinationId: "lisboa" })).ok).toBe(false);
    expect((await save({ customName: "lisbôa", customRegion: "europa" })).ok).toBe(false);
  });

  it("editar o nome para um destino do catálogo também resolve", async () => {
    await save({ customName: "Praga", customRegion: "europa" });
    const [row] = await rows();
    expect((await save({ id: row!.id, customName: "Roma", customRegion: "europa" })).ok).toBe(true);
    expect((await rows())[0]).toMatchObject({ destinationId: "roma", customName: null });
  });

  it("nome de verdade fora do catálogo continua livre, e exige região", async () => {
    expect((await save({ customName: "Praga" })).message).toBe("Escolha a região do lugar.");
    expect((await save({ customName: "Praga", customRegion: "europa" })).ok).toBe(true);
    expect((await rows())[0]).toMatchObject({ destinationId: null, customName: "Praga" });
  });

  it("acento também não abre outra linha de nome livre", async () => {
    await save({ customName: "São Tomé", customRegion: "america_sul" });
    const repeated = await save({ customName: "sao tome", customRegion: "america_sul" });
    expect(repeated.message).toBe("Este lugar já está na sua lista.");
  });

  it("caractere invisível no nome some, sem virar espaço", async () => {
    await save({ customName: "Pra​ga", customRegion: "europa" });
    expect((await rows())[0]!.customName).toBe("Praga");
  });
});

describe("sugestão genérica pendente do mesmo destino", () => {
  /** A primeira sugestão, antes de qualquer intenção, é sempre genérica. */
  const generic = async () => {
    await runAgent();
    const [row] = await pending();
    return agents.viagemPayloadSchema.parse(row!.payload);
  };

  it("criar a intenção tira a genérica", async () => {
    const { destinationId } = await generic();
    expect((await save({ destinationId })).ok).toBe(true);
    expect(await pending()).toEqual([]);
  });

  it("escrever o nome igual ao catálogo também tira", async () => {
    const { name } = await generic();
    expect((await save({ customName: name.toUpperCase(), customRegion: "europa" })).ok).toBe(true);
    expect(await pending()).toEqual([]);
  });

  it("editar a intenção para esse destino também tira", async () => {
    const { destinationId } = await generic();
    await save({ customName: "Praga", customRegion: "europa" });
    const [row] = await rows();
    expect(await pending()).toHaveLength(1);
    expect((await save({ id: row!.id, destinationId })).ok).toBe(true);
    expect(await pending()).toEqual([]);
  });

  it("a de outro destino fica", async () => {
    const { destinationId } = await generic();
    const other = destinationId === "roma" ? "lisboa" : "roma";
    await save({ destinationId: other });
    expect(await pending()).toHaveLength(1);
  });
});

describe("catálogo do formulário", () => {
  it("traz o país, para a busca achar por ele", async () => {
    await save({ destinationId: "lisboa" });
    const data = await loadTripIntentionItems(await ctxNow());
    expect(data?.catalog.find((row) => row.id === "lisboa")).toMatchObject({ country: "PT" });
    const found = domain.searchDestinations(data!.catalog, "Portugal");
    expect(found.map((row) => row.id)).toEqual(["lisboa"]);
  });
});
