// Documento da conta na ponta da web, contra um Postgres real com RLS: gravado cifrado, hash único, nada no
// log, mascarado ao ler, e o que acontece sem a chave. CPF e CNPJ fictícios.
import { randomBytes } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
  vi,
} from "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrls: { owner: string; app: string; worker: string; admin: string };
  }
}

const urls = inject("dbUrls");
process.env.DATABASE_URL = urls.app;
process.env.ADMIN_DATABASE_URL = urls.admin;

const db = await import("@organizeup/db");
const { cnpjCheckDigits, parseIdentity } = await import("@organizeup/domain");
const { identityForExport, identityView, openedIdentity, shouldAskDocument, storeIdentity } =
  await import("./identity");
const { user } = db;

const CPF = "000.000.001-91";
const CPF_DIGITS = "00000000191";
const CPF_B = "000.000.002-72";
const CNPJ = "12.ABC.345/01DE-35";
const CNPJ_DIGITS = "12ABC34501DE35";
const CNPJ_SECOND = `00AB00000001${cnpjCheckDigits("00AB00000001")}`;
const CNPJ_THIRD = `00AB00000002${cnpjCheckDigits("00AB00000002")}`;
const COMPANY = "Comercio Exemplo 00000000191";

const parsed = (raw: unknown) => {
  const result = parseIdentity(raw);
  if (!result.ok) throw new Error("documento de teste inválido");
  return result.value;
};
const person = (cpf: string) => parsed({ inBrazil: true, personType: "pf", cpf });
const companyOf = (cpf: string, cnpj: string, companyName = COMPANY) =>
  parsed({ inBrazil: true, personType: "pj", cpf, cnpj, companyName });
const company = companyOf(CPF, CNPJ);

const KEY = randomBytes(32).toString("base64");

/** A linha como está no banco, pela conexão administrativa. */
const rowOf = async (id: string) => {
  const rows = await db.withAdmin("leitura do teste de documento", (admin) =>
    admin.select().from(db.userIdentity).where(db.eq(db.userIdentity.userId, id)),
  );
  return rows[0];
};

beforeAll(async () => {
  vi.stubEnv("DOCUMENT_ENCRYPTION_KEY", KEY);
  await db.withAdmin("seed do teste de documento", (admin) =>
    admin.insert(user).values(
      ["pf", "pj", "pj-do-pf", "pj-dois", "dup", "cnpj-dup", "fora", "sem-chave"].map((id) => ({
        id,
        name: `Conta ${id}`,
        email: `doc.${id}@example.com`,
      })),
    ),
  );
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await db.closeAllPools();
});

describe("guardar", () => {
  let spies: Array<ReturnType<typeof vi.spyOn>>;
  beforeEach(() => {
    spies = (["log", "info", "warn", "error"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
  });
  afterEach(() => {
    const said = spies.flatMap((spy) => spy.mock.calls).flat();
    expect(JSON.stringify(said)).not.toMatch(/00000000191|000\.000|12ABC|Comercio/);
    vi.restoreAllMocks();
  });

  it("pessoa física: só cifrado no banco, com hash", async () => {
    expect(await storeIdentity("pf", person(CPF_B))).toBe("ok");
    const row = (await rowOf("pf"))!;
    expect(row.personType).toBe("pf");
    expect(row.cpfEncrypted).toMatch(/^v1\./);
    expect(row.cpfHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain("00000000272");
  });

  it("empresa: CPF, CNPJ e razão social cifrados, porque a de MEI costuma trazer o CPF", async () => {
    expect(await storeIdentity("pj", company)).toBe("ok");
    const text = JSON.stringify(await rowOf("pj"));
    for (const secret of [CPF_DIGITS, CNPJ_DIGITS, "Comercio"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("CPF repetido em pessoa física recusa, neutro, com ou sem pontuação", async () => {
    expect(await storeIdentity("dup", person(CPF_B))).toBe("refused");
    expect(await storeIdentity("dup", person("00000000272"))).toBe("refused");
    expect(await rowOf("dup")).toBeUndefined();
  });

  it("o mesmo CPF é aceito em conta PF e em conta PJ", async () => {
    expect(await storeIdentity("pj-do-pf", companyOf(CPF_B, CNPJ_SECOND))).toBe("ok");
  });

  it("dois PJ com o mesmo responsável e CNPJs diferentes são aceitos", async () => {
    expect(await storeIdentity("pj-dois", companyOf(CPF, CNPJ_THIRD))).toBe("ok");
    expect((await rowOf("pj-dois"))?.cpfHash).toBe((await rowOf("pj"))?.cpfHash);
  });

  it("CNPJ repetido recusa, mesmo com outro responsável", async () => {
    expect(await storeIdentity("cnpj-dup", companyOf("000.000.003-53", CNPJ))).toBe("refused");
    expect(await rowOf("cnpj-dup")).toBeUndefined();
  });

  it("documento já informado não é trocado, e a resposta é a mesma", async () => {
    expect(await storeIdentity("pf", person("000.000.004-34"))).toBe("refused");
  });

  it("quem mora fora guarda só a resposta", async () => {
    expect(await storeIdentity("fora", parsed({ inBrazil: false }))).toBe("ok");
    expect(await rowOf("fora")).toMatchObject({ inBrazil: false, cpfEncrypted: null });
    expect(await identityView("fora")).toMatchObject({ abroad: true, ask: false, canFill: true });
  });

  it("sem a chave recusa, não grava nada, e quem mora fora continua", async () => {
    vi.stubEnv("DOCUMENT_ENCRYPTION_KEY", "");
    expect(await storeIdentity("sem-chave", person("000.000.004-34"))).toBe("unavailable");
    expect(await rowOf("sem-chave")).toBeUndefined();
    expect(await shouldAskDocument("sem-chave")).toBe(false);
    expect(await storeIdentity("sem-chave", parsed({ inBrazil: false }))).toBe("ok");
    expect(JSON.stringify(spies[3]!.mock.calls)).toContain("document_key_missing");
    await db.withAdmin("limpeza do teste de documento", (admin) =>
      admin.delete(db.userIdentity).where(db.eq(db.userIdentity.userId, "sem-chave")),
    );
    vi.stubEnv("DOCUMENT_ENCRYPTION_KEY", KEY);
  });
});

describe("ler", () => {
  it("a tela recebe só o mascarado", async () => {
    const view = await identityView("pj");
    expect(view).toMatchObject({
      personType: "pj",
      cpf: "***.000.001-**",
      cnpj: "**.ABC.345/01DE-**",
      companyName: COMPANY,
      canFill: false,
      ask: false,
    });
  });

  it("sem a chave a tela diz que há documento, sem mostrar nada", async () => {
    vi.stubEnv("DOCUMENT_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    expect(await identityView("pj")).toMatchObject({ personType: "pj", cpf: null, cnpj: null });
    vi.stubEnv("DOCUMENT_ENCRYPTION_KEY", KEY);
  });

  it("conta antiga, sem linha, recebe o pedido uma vez", async () => {
    expect(await shouldAskDocument("dup")).toBe(true);
    await db.dismissIdentityPrompt("dup");
    expect(await shouldAskDocument("dup")).toBe(false);
    expect(await identityView("dup")).toMatchObject({ ask: false, canFill: true, abroad: false });
  });

  it("o arquivo de dados sai mascarado, com aviso e sem o número da razão social", async () => {
    const data = await identityForExport("pj");
    expect(data.aviso).toContain("mascarados");
    expect(data).toMatchObject({ tipo: "pj", cpf: "***.000.001-**", cnpj: "**.ABC.345/01DE-**" });
    expect(data.razaoSocial).toBe("Comercio Exemplo ***********");
    expect(JSON.stringify(data)).not.toContain(CPF_DIGITS);
  });

  it("o painel abre o documento só depois da ação registrada", async () => {
    const sealed = await db.adminRevealIdentity({ adminUserId: "pf" }, "pj");
    if (typeof sealed === "string") throw new Error(sealed);
    expect(openedIdentity("pj", sealed)).toEqual({ cpf: CPF, cnpj: CNPJ, companyName: COMPANY });
  });
});
