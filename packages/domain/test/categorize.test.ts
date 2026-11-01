import { describe, expect, it } from "vitest";
import {
  CONTRIBUTION_CATEGORY,
  GOAL_CATEGORY,
  KEYWORDS,
  categorizeRow,
  categoryCandidates,
  dailyCategoryReport,
  effectiveCategorySource,
  importReport,
  isCategoryCandidate,
  isFallbackCategory,
  isGenericCategory,
  isProtectedCategory,
  memoryKey,
  merchantKey,
  nearDuplicateCategory,
  planCategoryMoves,
  reviewCategories,
  suggestCategoryMerges,
  validNewCategoryName,
  withAiSummary,
  type CandidateTransaction,
  type CategoryAnswer,
  type CategoryCandidate,
  type CategoryMemory,
  type CategoryOption,
  type ReviewTransaction,
} from "../src";

const categories: CategoryOption[] = [
  { id: "m", name: "Mercado", kind: "despesa" },
  { id: "l", name: "Lazer", kind: "despesa" },
  { id: "o", name: "Outras despesas", kind: "despesa" },
  { id: "s", name: "Salário", kind: "receita" },
  { id: "x", name: "Outras receitas", kind: "receita" },
];
const empty: CategoryMemory = { history: new Map(), learned: new Map() };
const despesa = (description: string) => ({ description, kind: "despesa" as const });

describe("estabelecimento", () => {
  it("ignora meio de pagamento, datas e números", () => {
    const key = "padaria sao jose";
    expect(merchantKey("COMPRA CARTAO PADARIA SAO JOSE 15/10")).toBe(key);
    expect(merchantKey("Pix enviado Padaria São José")).toBe(key);
    expect(merchantKey("PIX 123456")).toBe("");
  });
});

describe("agente de categorização", () => {
  it("usa palavra conhecida, sem acento e sem caixa", () => {
    expect(categorizeRow(despesa("SUPERMERCADO BOM PREÇO"), categories, empty)).toEqual({
      categoryId: "m",
      newCategory: null,
      source: "palavra",
    });
    const salary = { description: "PAGTO SALÁRIO", kind: "receita" as const };
    expect(categorizeRow(salary, categories, empty).categoryId).toBe("s");
  });

  it("propõe criar a categoria que a família não tem", () => {
    expect(categorizeRow(despesa("IFOOD *RESTAURANTE"), categories, empty)).toEqual({
      categoryId: null,
      newCategory: { name: "Restaurantes", essential: false },
      source: "nova",
    });
    expect(categorizeRow(despesa("Seguro do carro"), categories, empty).newCategory).toEqual({
      name: "Seguros",
      essential: true,
    });
  });

  it("não cria categoria que já existe com outra grafia", () => {
    const own = [...categories, { id: "r", name: "RESTAURANTES", kind: "despesa" as const }];
    expect(categorizeRow(despesa("Pizzaria Exemplo"), own, empty).categoryId).toBe("r");
  });

  it("a memória da família vem antes das palavras", () => {
    const key = memoryKey("despesa", "supermercado");
    const learned = { history: new Map(), learned: new Map([[key, "l"]]) };
    expect(categorizeRow(despesa("Supermercado 123"), categories, learned)).toMatchObject({
      categoryId: "l",
      source: "memoria",
    });
  });

  it("o que a família mudou depois vence o que o agente guardou", () => {
    const key = memoryKey("despesa", "supermercado");
    const memory = { history: new Map([[key, "m"]]), learned: new Map([[key, "l"]]) };
    expect(categorizeRow(despesa("Supermercado"), categories, memory).categoryId).toBe("m");
  });

  it("ignora memória de categoria arquivada ou de outro tipo", () => {
    const key = memoryKey("despesa", "supermercado");
    const memory = { history: new Map([[key, "s"]]), learned: new Map([[key, "sumiu"]]) };
    expect(categorizeRow(despesa("Supermercado"), categories, memory)).toMatchObject({
      categoryId: "m",
      source: "palavra",
    });
  });

  it("sem pista, usa Outras e pede revisão", () => {
    expect(categorizeRow(despesa("XPTO"), categories, empty)).toMatchObject({
      categoryId: "o",
      source: "revisar",
    });
    const income = { description: "XPTO", kind: "receita" as const };
    expect(categorizeRow(income, categories, empty).categoryId).toBe("x");
  });

  it("aportes e aplicações são dinheiro guardado, não gasto", () => {
    expect(GOAL_CATEGORY).toBe("Metas e objetivos");
    expect(KEYWORDS.despesa.some((group) => group.category === CONTRIBUTION_CATEGORY)).toBe(true);
    expect(categorizeRow(despesa("APLICACAO CDB BANCO"), categories, empty).newCategory?.name).toBe(
      "Aportes e investimentos",
    );
    expect(categorizeRow(despesa("TESOURO DIRETO"), categories, empty).newCategory?.name).toBe(
      CONTRIBUTION_CATEGORY,
    );
    // "lca" dentro de outra palavra não conta.
    expect(categorizeRow(despesa("ALCANCE PAPELARIA"), categories, empty).source).toBe("revisar");
  });

  it("reconhece as categorias de fallback", () => {
    expect(isFallbackCategory("Outras despesas")).toBe(true);
    expect(isFallbackCategory("outras receitas")).toBe(true);
    expect(isFallbackCategory("Mercado")).toBe(false);
  });
});

describe("categorização com IA", () => {
  const options: CategoryOption[] = [
    { id: "m", name: "Mercado", kind: "despesa" },
    { id: "s", name: "Salário", kind: "receita" },
    { id: "o", name: "Outras despesas", kind: "despesa" },
    { id: "p", name: GOAL_CATEGORY, kind: "despesa" },
    { id: "a", name: CONTRIBUTION_CATEGORY, kind: "despesa" },
  ];
  const candidate = (over: Partial<CandidateTransaction> = {}): CandidateTransaction => ({
    id: "t1",
    kind: "despesa",
    description: "LOJA ATOMO",
    amount: "10.00",
    categoryId: "o",
    categoryName: "Outras despesas",
    categorySource: "importacao",
    importBatchId: "b",
    ...over,
  });
  const group = (merchant: string, kind: "despesa" | "receita" = "despesa"): CategoryCandidate => ({
    kind,
    merchant,
    ids: [merchant],
    sample: merchant,
    fromCategoryId: "o",
    count: 1,
    total: "10.00",
    average: "10.00",
  });
  const answer = (over: Partial<CategoryAnswer> = {}): CategoryAnswer => ({
    grupo: 1,
    categoria: null,
    novaCategoria: null,
    essencial: false,
    confianca: "alta",
    ...over,
  });
  const plan = (answers: CategoryAnswer[], groups = [group("loja a")], maxNew = 5) =>
    planCategoryMoves({ groups, answers, categories: options, maxNew });

  it("reconhece genérica por nome normalizado, sem pegar categoria de verdade", () => {
    expect(isGenericCategory("OUTRAS DESPESAS")).toBe(true);
    expect(isGenericCategory("Não classificado")).toBe(true);
    expect(isGenericCategory("diversos")).toBe(true);
    expect(isGenericCategory("Mercado")).toBe(false);
  });

  it("categoria de sistema nunca é candidata, mesmo marcada para revisar", () => {
    const protectedRow = { categoryName: GOAL_CATEGORY, categorySource: "revisar" as const };
    expect(isCategoryCandidate({ ...protectedRow, importBatchId: null })).toBe(false);
    expect(isProtectedCategory("Transferências")).toBe(true);
    expect(isProtectedCategory("Cartão de crédito")).toBe(true);
    expect(isProtectedCategory("Mercado")).toBe(false);
  });

  it("agrupa por estabelecimento, soma em decimal e traz os maiores primeiro", () => {
    const rows = [
      candidate({ id: "1", description: "PIX LOJA ATOMO 12/10", amount: "0.10" }),
      candidate({ id: "2", description: "COMPRA LOJA ATOMO 13/10", amount: "0.20" }),
      candidate({ id: "3", description: "LOJA BETA", amount: "5.00" }),
      candidate({ id: "4", description: "PIX 123", amount: "900.00" }),
    ];
    const groups = categoryCandidates(rows, new Set(), 10);
    expect(groups.map((row) => row.merchant)).toEqual(["loja beta", "loja atomo"]);
    expect(groups[1]).toMatchObject({ ids: ["1", "2"], count: 2, total: "0.30", average: "0.15" });
  });

  it("respeita o limite e o que já foi decidido", () => {
    const rows = [
      candidate({ id: "1", description: "LOJA ATOMO", amount: "100.00" }),
      candidate({ id: "2", description: "LOJA BETA", amount: "50.00" }),
      candidate({ id: "3", description: "LOJA GAMA", amount: "10.00" }),
    ];
    const closed = new Set([memoryKey("despesa", "loja atomo")]);
    expect(categoryCandidates(rows, closed, 1).map((row) => row.merchant)).toEqual(["loja beta"]);
  });

  it("recusa nome que não é nome de categoria", () => {
    for (const name of ["ab", "Loja 123", "https://exemplo", "Um dois três quatro cinco"]) {
      expect(validNewCategoryName(name)).toBe(false);
    }
    expect(validNewCategoryName("Outras")).toBe(false);
    expect(validNewCategoryName("Transferências")).toBe(false);
    expect(validNewCategoryName("Pets e veterinário")).toBe(true);
  });

  it("acha quase-duplicata por acento, plural, erro de digitação e nome contido", () => {
    const list = [{ name: "Saúde" }, { name: "Restaurantes" }, { name: "Educação" }];
    expect(nearDuplicateCategory("SAUDE", list)?.name).toBe("Saúde");
    expect(nearDuplicateCategory("Restaurante", list)?.name).toBe("Restaurantes");
    expect(nearDuplicateCategory("Restaurentes", list)?.name).toBe("Restaurantes");
    expect(nearDuplicateCategory("Restaurantes e bares", list)?.name).toBe("Restaurantes");
    expect(nearDuplicateCategory("Viagens", list)).toBeNull();
  });

  it("categoria existente de outro tipo ou inventada é recusada", () => {
    expect(plan([answer({ categoria: "Salário" })]).rejected).toHaveLength(1);
    expect(plan([answer({ categoria: "Inventada" })]).rejected).toHaveLength(1);
  });

  it("destino de sistema é recusado, por nome existente ou por nome novo", () => {
    expect(plan([answer({ categoria: GOAL_CATEGORY })]).rejected).toHaveLength(1);
    expect(plan([answer({ novaCategoria: "Metas e objetivo" })]).rejected).toHaveLength(1);
  });

  it("sem resposta ou genérica vira desconhecido, não movimento", () => {
    expect(plan([answer()]).unknown).toHaveLength(1);
    expect(plan([answer({ categoria: "Outras despesas" })]).unknown).toHaveLength(1);
    expect(plan([answer({ novaCategoria: "Diversos" })]).unknown).toHaveLength(1);
  });

  it("funde quase-duplicata na existente e em nome novo da mesma noite", () => {
    expect(plan([answer({ novaCategoria: "Mercados" })]).moves[0]?.target).toEqual({
      categoryId: "m",
      newCategory: null,
    });
    const twin = plan(
      [
        answer({ grupo: 1, novaCategoria: "Pets", essencial: true }),
        answer({ grupo: 2, novaCategoria: "Pet" }),
      ],
      [group("loja a"), group("loja b")],
    );
    expect(twin.moves.map((move) => move.target.newCategory)).toEqual([
      { name: "Pets", essential: true },
      { name: "Pets", essential: true },
    ]);
  });

  it("mesmo nome em tipos diferentes não se funde", () => {
    const both = plan(
      [answer({ grupo: 1, novaCategoria: "Bicos" }), answer({ grupo: 2, novaCategoria: "Bicos" })],
      [group("loja a"), group("loja b", "receita")],
    );
    expect(both.moves).toHaveLength(2);
  });

  it("passa do limite de categorias novas fica para a próxima noite", () => {
    const groups = [group("loja a"), group("loja b"), group("loja c")];
    const capped = plan(
      [
        answer({ grupo: 1, novaCategoria: "Papelaria" }),
        answer({ grupo: 2, novaCategoria: "Jardinagem" }),
        answer({ grupo: 3, novaCategoria: "Mercados" }),
      ],
      groups,
      1,
    );
    expect(capped.moves).toHaveLength(2);
    expect(capped.deferred).toBe(1);
  });

  it("ignora grupo fora da lista e resposta repetida", () => {
    const result = plan([
      answer({ grupo: 9, categoria: "Mercado" }),
      answer({ grupo: 1, categoria: "Mercado" }),
      answer({ grupo: 1, categoria: "Salário" }),
    ]);
    expect(result.moves).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it("o resumo do dia troca o trecho da IA em vez de repetir", () => {
    const ia = { groups: 1, moved: 2, created: ["Pets"], pending: 0, skipped: 0 };
    const once = withAiSummary("1 lançamento revisado.", ia);
    expect(once).toContain("2 lançamentos movidos");
    expect(once).toContain("Categorias criadas: Pets.");
    const twice = withAiSummary(once, { ...ia, moved: 3 });
    expect(twice).toContain("3 lançamentos movidos");
    expect(twice).not.toContain("2 lançamentos movidos");
  });
});

describe("revisão diária de categorias", () => {
  const own = [...categories, { id: "r", name: "Restaurantes", kind: "despesa" as const }];
  const row = (
    id: string,
    description: string,
    categoryId: string,
    categorySource: ReviewTransaction["categorySource"],
    importBatchId: string | null = null,
  ): ReviewTransaction => ({
    id,
    kind: "despesa",
    description,
    categoryId,
    categoryName: own.find((c) => c.id === categoryId)!.name,
    categorySource,
    importBatchId,
  });
  const transactions = [
    row("t1", "SUPERMERCADO BOM 10/10", "o", "revisar"),
    row("t7", "SUPERMERCADO BOM 12/10", "o", null, "lote"),
    row("t2", "XPTO LTDA", "o", "revisar"),
    row("t3", "PADARIA SAO JOSE", "o", "familia"),
    row("t4", "POSTO SHELL", "m", "familia"),
    row("t5", "POSTO SHELL", "l", "familia"),
    row("t6", "POSTO SHELL 2", "m", "importacao"),
  ];

  it("lançamento antigo sem origem conta como revisar só com lote e fallback", () => {
    expect(
      effectiveCategorySource({
        categorySource: null,
        categoryName: "Outras despesas",
        importBatchId: "b",
      }),
    ).toBe("revisar");
    expect(
      effectiveCategorySource({
        categorySource: null,
        categoryName: "Outras despesas",
        importBatchId: null,
      }),
    ).toBe("familia");
    expect(
      effectiveCategorySource({
        categorySource: "agente",
        categoryName: "Mercado",
        importBatchId: null,
      }),
    ).toBe("agente");
  });

  it("move sozinho o que ficou para revisar e a regra resolve", () => {
    const review = reviewCategories({
      transactions,
      categories: own,
      memory: empty,
      blocked: new Set(),
    });
    expect(review.automatic).toEqual([
      {
        ids: ["t1", "t7"],
        kind: "despesa",
        merchant: "supermercado bom",
        fromCategoryId: "o",
        toCategoryId: "m",
        newCategory: null,
        reason: "Ficou em Outras na importação e a regra conhece o estabelecimento",
        dedupeKey: "categoria:despesa:supermercado bom:m",
      },
    ]);
  });

  it("o que a família deixou em Outras e o estabelecimento inconsistente só viram sugestão", () => {
    const review = reviewCategories({
      transactions,
      categories: own,
      memory: empty,
      blocked: new Set(),
    });
    const padaria = review.suggested.find((g) => g.merchant === "padaria sao jose");
    expect(padaria).toMatchObject({ ids: ["t3"], fromCategoryId: "o", toCategoryId: "r" });
    const posto = review.suggested.find((g) => g.merchant === "posto shell");
    expect(posto).toMatchObject({
      ids: ["t5"],
      fromCategoryId: "l",
      toCategoryId: "m",
      reason: "Mesmo estabelecimento em 2 categorias nos últimos 90 dias",
      dedupeKey: "categoria:despesa:posto shell:m",
    });
    expect(review.suggested.some((g) => g.ids.includes("t2"))).toBe(false);
  });

  it("a memória da família decide o destino da inconsistência", () => {
    const memory = {
      history: new Map([[memoryKey("despesa", "posto shell"), "l"]]),
      learned: new Map(),
    };
    const review = reviewCategories({ transactions, categories: own, memory, blocked: new Set() });
    const posto = review.suggested.find((g) => g.merchant === "posto shell");
    expect(posto).toMatchObject({ ids: ["t4", "t6"], toCategoryId: "l" });
  });

  it("memória do agente só sugere, e o que a família desfez não volta", () => {
    const agentLearned = new Map([[memoryKey("despesa", "xpto ltda"), "l"]]);
    const blocked = new Set(["categoria:despesa:supermercado bom:m"]);
    const review = reviewCategories({
      transactions,
      categories: own,
      memory: empty,
      agentLearned,
      blocked,
    });
    expect(review.automatic).toEqual([]);
    expect(review.suggested.some((g) => g.merchant === "supermercado bom")).toBe(false);
    expect(review.suggested.find((g) => g.ids.includes("t2"))).toMatchObject({
      toCategoryId: "l",
      reason: "O assistente já viu este estabelecimento em Lazer",
    });
  });

  it("propõe criar a categoria quando a família não a tem", () => {
    const review = reviewCategories({
      transactions: [row("t9", "IFOOD *RESTAURANTE", "o", "revisar")],
      categories,
      memory: empty,
      blocked: new Set(),
    });
    expect(review.automatic[0]).toMatchObject({
      toCategoryId: null,
      newCategory: { name: "Restaurantes", essential: false },
      dedupeKey: "categoria:despesa:ifood restaurante:new:restaurantes",
    });
  });
});

describe("fusão de categorias", () => {
  const cat = (id: string, name: string, template: boolean, archived = false) => ({
    id,
    name,
    kind: "despesa" as const,
    template,
    archived,
  });
  const list = [
    cat("a", "Mercado", true),
    cat("b", "mercado", false),
    cat("c", "Lazer", true),
    cat("d", "Lazer e cultura", false),
    cat("e", "Farmácia", false),
    cat("f", "Saúde", true),
    cat("g", "Cinema", false),
    cat("h", "Mercado", true, true),
  ];
  const usage = [
    { categoryId: "a", count: 20 },
    { categoryId: "b", count: 2 },
    { categoryId: "c", count: 5 },
    { categoryId: "d", count: 1 },
    { categoryId: "e", count: 1 },
    { categoryId: "f", count: 3 },
    { categoryId: "g", count: 10 },
  ];

  it("junta nomes iguais ou contidos e pouco usadas que casam com palavras de outra", () => {
    expect(suggestCategoryMerges(list, usage)).toEqual([
      { fromCategoryId: "b", toCategoryId: "a", reason: "Nomes iguais ou um contém o outro" },
      { fromCategoryId: "d", toCategoryId: "c", reason: "Nomes iguais ou um contém o outro" },
      {
        fromCategoryId: "e",
        toCategoryId: "f",
        reason: "Nome casa com as palavras de outra categoria",
      },
    ]);
  });

  it("não funde categoria usada nem de outro tipo", () => {
    const mixed = [
      cat("a", "Aluguel", true),
      { ...cat("b", "Aluguel", true), kind: "receita" as const },
    ];
    expect(suggestCategoryMerges(mixed, [])).toEqual([]);
    expect(
      suggestCategoryMerges([cat("g", "Cinema", false), cat("c", "Lazer", true)], usage),
    ).toEqual([]);
  });
});

describe("relatório diário de categorias", () => {
  it("conta movidos, sugestões e fusões", () => {
    const group = {
      ids: ["a", "b"],
      kind: "despesa" as const,
      merchant: "x",
      fromCategoryId: "o",
      toCategoryId: "m",
      newCategory: null,
      reason: "",
      dedupeKey: "k",
    };
    const report = dailyCategoryReport(
      { automatic: [group], suggested: [group, group] },
      [{ fromCategoryId: "b", toCategoryId: "a", reason: "" }],
      { reviewed: 40, created: ["Pets"], day: "2026-10-31" },
    );
    expect(report.title).toBe("Categorias revisadas em 2026-10-31");
    expect(report.summary).toBe(
      "40 lançamentos revisados, 2 movidos sozinhos, 2 sugestões para decidir, 1 fusão sugerida. Categorias criadas: Pets.",
    );
    expect(report.data).toEqual({
      reviewed: 40,
      moved: 2,
      created: ["Pets"],
      pending: 2,
      merges: 1,
    });
  });
});

describe("relatório da importação", () => {
  it("resume o que o agente fez e o que a família corrigiu", () => {
    const row = { kind: "despesa" as const, amount: "10.00", category: "Mercado" };
    const report = importReport(
      [
        { ...row, source: "memoria", corrected: false },
        { ...row, source: "palavra", corrected: false },
        { ...row, source: "nova", corrected: false },
        { ...row, source: "revisar", corrected: true },
      ],
      ["Pets"],
      { start: "2026-10-01", end: "2026-10-31" },
    );
    expect(report.title).toBe("Extrato de 2026-10-01 a 2026-10-31");
    expect(report.summary).toBe(
      "4 lançamentos, 1 pela memória da família, 2 por palavras do extrato, 1 sem pista. Categorias criadas: Pets. A família corrigiu 1.",
    );
    expect(report.data.corrected).toBe(1);
  });
});
