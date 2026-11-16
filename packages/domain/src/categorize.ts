// Agente de categorização do extrato (ADR-0013) e revisão diária de categorias (ADR-0015). Puro:
// recebe a memória da família e devolve propostas. Nada é gravado aqui. Na importação a família
// revisa tudo antes de gravar; na revisão diária, o que está em categoria genérica muda sozinho, e o
// que a família pôs numa categoria específica não muda nem vira pergunta (AGENTS.md, regra 7). O texto
// do extrato é dado não confiável: só serve para comparar palavras.
import { CARD_CATEGORY } from "./card";
import { DEBT_CATEGORY } from "./debt";
import { message, sentences, type Message } from "./messages";
import { money, toDbAmount } from "./money";
import { CONTRIBUTION_CATEGORY, GOAL_CATEGORY } from "./savings";
import { normalizeDescription, type StatementKind, type StatementRow } from "./statement";

export interface CategoryOption {
  id: string;
  name: string;
  kind: StatementKind;
}

/** De onde veio a categoria proposta. */
export type CategorySource = "memoria" | "palavra" | "nova" | "revisar";

export interface CategoryProposal {
  /** Null quando a proposta é criar uma categoria. */
  categoryId: string | null;
  newCategory: { name: string; essential: boolean } | null;
  source: CategorySource;
}

export interface KeywordGroup {
  category: string;
  words: readonly string[];
  /** Vale ao criar a categoria. */
  essential?: boolean;
  /** A palavra só vale com um destes termos na descrição. */
  requires?: readonly string[];
  /** A palavra não vale com nenhum destes termos na descrição. */
  excludes?: readonly string[];
}

/** Palavras frequentes em extratos. Correspondência por palavras inteiras. Somente leitura. */
export const KEYWORDS: Readonly<Record<StatementKind, readonly KeywordGroup[]>> = {
  despesa: [
    {
      category: "Mercado",
      essential: true,
      words: [
        "mercado",
        "supermercado",
        "supermercados",
        "atacado",
        "atacadao",
        "atacadista",
        "assai",
        "carrefour",
        "hortifruti",
        "pao de acucar",
        "walmart",
        "makro",
        "roldao",
      ],
    },
    {
      category: "Luz, água e internet",
      essential: true,
      words: [
        "enel",
        "cemig",
        "copel",
        "sabesp",
        "cpfl",
        "energia",
        "saneamento",
        "vivo fibra",
        "claro net",
        "internet",
        "telefonica",
      ],
    },
    {
      category: "Transporte",
      essential: true,
      words: [
        "uber",
        "posto",
        "combustivel",
        "shell",
        "ipiranga",
        "estacionamento",
        "pedagio",
        "sem parar",
        "metro",
        "onibus",
        "taxi",
        "combustiveis",
      ],
    },
    {
      category: "Saúde",
      essential: true,
      words: [
        "farmacia",
        "drogaria",
        "drogasil",
        "drogaraia",
        "droga raia",
        "unimed",
        "amil",
        "hospital",
        "clinica",
        "laboratorio",
        "dentista",
        "pague menos",
        "ultrafarma",
        "panvel",
        "extrafarma",
      ],
    },
    { category: "Moradia", essential: true, words: ["aluguel", "condominio", "iptu"] },
    {
      category: "Educação",
      essential: true,
      words: [
        "escola",
        "colegio",
        "faculdade",
        "universidade",
        "curso",
        "cursos",
        "mensalidade escolar",
        "udemy",
        "alura",
        "coursera",
        "senai",
        "senac",
        "material escolar",
      ],
    },
    {
      category: "Assinaturas",
      words: [
        "netflix",
        "spotify",
        "prime video",
        "disney",
        "hbo",
        "youtube",
        "icloud",
        "google one",
        "deezer",
        "globoplay",
        "paramount",
        "apple music",
        "apple tv",
        "canva",
        "adobe",
        "amazon music",
      ],
    },
    {
      category: "Restaurantes",
      words: [
        "restaurante",
        "ifood",
        "lanchonete",
        "pizzaria",
        "padaria",
        "churrascaria",
        "burger",
        "uber eats",
        "cafeteria",
        "rappi",
        "aiqfome",
        "ze delivery",
      ],
    },
    { category: "Lazer", words: ["cinema", "ingresso", "bar ", "teatro", "show "] },
    {
      category: "Compras",
      words: [
        "magazine",
        "mercado livre",
        "shopee",
        "amazon",
        "americanas",
        "renner",
        "shein",
        "submarino",
        "casas bahia",
        "magalu",
        "ebay",
      ],
    },
    {
      category: "Pets",
      words: [
        "petz",
        "cobasi",
        "petshop",
        "pet shop",
        "veterinario",
        "veterinaria",
        "petlove",
        "racao",
        "banho e tosa",
      ],
    },
    {
      category: "Tarifas bancárias",
      words: [
        "tarifa",
        "anuidade",
        "iof",
        "cesta de servicos",
        "pacote de servicos",
        "taxa de manutencao",
        "juros de mora",
        "multa por atraso",
      ],
    },
    {
      category: "Vestuário",
      words: [
        "roupas",
        "calcados",
        "riachuelo",
        "hering",
        "centauro",
        "decathlon",
        "arezzo",
        "track field",
        "dafiti",
        "netshoes",
      ],
    },
    {
      category: "Impostos e taxas",
      essential: true,
      words: ["ipva", "darf", "receita federal", "detran", "licenciamento"],
    },
    { category: "Seguros", essential: true, words: ["seguro", "seguradora"] },
    {
      // Modelo `d-aportes`: dinheiro que foi guardado, não gasto (ADR-0016).
      category: CONTRIBUTION_CATEGORY,
      words: [
        "corretora",
        "aplicacao",
        "aplic",
        "aplicacoes",
        "tesouro",
        " cdb ",
        " lci ",
        " lca ",
        "previdencia",
        // Liquidação de compra na bolsa, como a corretora escreve no extrato da conta.
        "operacoes em bolsa",
        "operacao em bolsa",
        "nota de corretagem",
      ],
    },
    {
      category: "Cuidados pessoais",
      words: ["salao", "barbearia", "cabeleireiro", "boticario", "perfumaria"],
    },
    { category: "Academia", words: ["academia", "smartfit", "smart fit"] },
    { category: "Viagens", words: ["hotel", "airbnb", "booking", "latam", "decolar", "passagem"] },
  ],
  receita: [
    {
      category: "Salário",
      words: [
        "salario",
        "folha de pagamento",
        "vencimentos",
        "remuneracao",
        "pro labore",
        "honorarios",
        "comissao",
        "bonificacao",
        "ferias",
      ],
    },
    {
      category: "Rendimentos",
      words: ["rendimento", "rendimentos", "dividendo", "dividendos", "juros"],
    },
    { category: "Aluguel recebido", words: ["aluguel"] },
    { category: "Reembolsos", words: ["estorno", "reembolso", "cashback", "devolucao"] },
    {
      // Venda na bolsa liquidada na conta: dinheiro que volta da carteira, não receita (ADR-0027).
      category: CONTRIBUTION_CATEGORY,
      words: ["operacoes em bolsa", "operacao em bolsa", "nota de corretagem"],
    },
    {
      // O outro lado da aplicação: dinheiro que já era da família, não receita (ADR-0027).
      category: CONTRIBUTION_CATEGORY,
      words: ["resgate", "resgates", "resg", "res aplic"],
      requires: [
        "cdb",
        "lci",
        "lca",
        "aplicacao",
        "aplicacoes",
        "aplic",
        "fundo",
        "fundos",
        "poupanca",
        "tesouro",
        "rdb",
        "previdencia",
      ],
      // "Resgate" também é FGTS, pontos e seguro: renda de verdade, ou dinheiro que não veio de aplicação.
      excludes: [
        "fgts",
        "fundo de garantia",
        "ponto",
        "pontos",
        "seguro",
        "seguros",
        "consorcio",
        "premio",
        "premios",
        "capitalizacao",
      ],
    },
  ],
};

/** Uma expressão específica prevalece sobre palavras contidas nela; conflitos pedem revisão. */
function keywordGroup(description: string, kind: StatementKind): KeywordGroup | undefined {
  const name = ` ${normalizeDescription(description)} `;
  const has = (words: readonly string[]) =>
    words.some((word) => name.includes(` ${normalizeDescription(word)} `));
  const allowed = KEYWORDS[kind].filter(
    (group) => (!group.requires || has(group.requires)) && !(group.excludes && has(group.excludes)),
  );
  const matches = allowed.flatMap((group) =>
    group.words.flatMap((word) => {
      const phrase = ` ${normalizeDescription(word)} `;
      const found: { group: KeywordGroup; start: number; end: number }[] = [];
      let start = name.indexOf(phrase);
      while (start !== -1) {
        found.push({ group, start, end: start + phrase.length });
        start = name.indexOf(phrase, start + 1);
      }
      return found;
    }),
  );
  const specific = matches.filter(
    (match) =>
      !matches.some(
        (other) =>
          other.start <= match.start &&
          other.end >= match.end &&
          other.end - other.start > match.end - match.start,
      ),
  );
  const groups = new Set(specific.map((match) => match.group));
  return groups.size === 1 ? [...groups][0] : undefined;
}

const FALLBACK: Record<StatementKind, string> = {
  despesa: "Outras despesas",
  receita: "Outras receitas",
};
/** Onde cai o que ninguém classificou, por tipo. */
export const FALLBACK_CATEGORY = FALLBACK;

/** Palavras que dizem como o dinheiro passou, não para quem. */
const NOISE = new Set(
  (
    "pix transf transferencia transferido enviado enviada recebido recebida ted doc compra compras " +
    "cartao debito credito pagamento pagto pag boleto deb aut automatico autorizada no na em de do da " +
    "dos das para qr code fatura parcela parcelas cobranca"
  ).split(" "),
);

/**
 * Chave do estabelecimento na memória: tira números, datas e palavras de meio de pagamento, para
 * "COMPRA CARTAO PADARIA SAO JOSE 15/10" e "Pix enviado Padaria Sao Jose" serem o mesmo lugar.
 */
export function merchantKey(description: string): string {
  const words = normalizeDescription(description)
    .split(" ")
    .filter((word) => word.length > 1 && !NOISE.has(word));
  return words.slice(0, 4).join(" ");
}

const sameName = (a: string, b: string) => normalizeDescription(a) === normalizeDescription(b);

/** "Outras despesas"/"Outras receitas": onde cai o que ninguém soube classificar. */
export function isFallbackCategory(name: string): boolean {
  return sameName(name, FALLBACK.despesa) || sameName(name, FALLBACK.receita);
}

export interface CategoryMemory {
  /** Quem a família já usou, por `tipo:estabelecimento`. A edição mais recente vence. */
  history: Map<string, string>;
  /** O que o agente guardou de importações anteriores, pela mesma chave. */
  learned: Map<string, string>;
}

export const memoryKey = (kind: StatementKind, merchant: string) => `${kind}:${merchant}`;

/**
 * Propõe a categoria: primeiro o que a família já fez, depois palavras conhecidas (criando a
 * categoria se ela não existir), por fim "Outras", marcada para revisar.
 */
export function categorizeRow(
  row: Pick<StatementRow, "description" | "kind">,
  categories: CategoryOption[],
  memory: CategoryMemory,
): CategoryProposal {
  const usable = categories.filter((category) => category.kind === row.kind);
  const has = (id: string | undefined) => usable.some((category) => category.id === id);
  const merchant = merchantKey(row.description);
  if (merchant) {
    const key = memoryKey(row.kind, merchant);
    const remembered = [memory.history.get(key), memory.learned.get(key)].find(has);
    if (remembered) return { categoryId: remembered, newCategory: null, source: "memoria" };
  }

  const group = keywordGroup(row.description, row.kind);
  if (group) {
    const existing = usable.find((category) => sameName(category.name, group.category));
    if (existing) return { categoryId: existing.id, newCategory: null, source: "palavra" };
    return {
      categoryId: null,
      newCategory: { name: group.category, essential: group.essential ?? false },
      source: "nova",
    };
  }

  const fallback = usable.find((category) => sameName(category.name, FALLBACK[row.kind]));
  return {
    categoryId: fallback?.id ?? usable[0]?.id ?? null,
    newCategory: null,
    source: "revisar",
  };
}

export interface ImportOutcomeRow {
  kind: StatementKind;
  amount: string;
  category: string;
  source: CategorySource;
  /** A família trocou o que o agente propôs. */
  corrected: boolean;
}

export interface ImportReport {
  title: string;
  summary: string;
  /** O mesmo relatório, por chave, para sair no idioma de quem lê. */
  message: Message;
  data: {
    rows: number;
    bySource: Record<CategorySource, number>;
    corrected: number;
    createdCategories: string[];
  };
}

/** Relatório de uma importação, para a família e para o assistente consultar depois. */
export function importReport(
  rows: ImportOutcomeRow[],
  createdCategories: string[],
  period: { start: string; end: string },
): ImportReport {
  const bySource: Record<CategorySource, number> = { memoria: 0, palavra: 0, nova: 0, revisar: 0 };
  for (const row of rows) bySource[row.source] += 1;
  const corrected = rows.filter((row) => row.corrected).length;
  const parts = [
    `${rows.length} ${rows.length === 1 ? "lançamento" : "lançamentos"}`,
    `${bySource.memoria} pela memória da família`,
    `${bySource.palavra + bySource.nova} por palavras do extrato`,
    `${bySource.revisar} sem pista`,
  ];
  const created =
    createdCategories.length > 0 ? ` Categorias criadas: ${createdCategories.join(", ")}.` : "";
  const fixes = corrected > 0 ? ` A família corrigiu ${corrected}.` : "";
  const counts = {
    rows: rows.length,
    memory: bySource.memoria,
    words: bySource.palavra + bySource.nova,
    noClue: bySource.revisar,
  };
  return {
    title: `Extrato de ${period.start} a ${period.end}`,
    summary: `${parts.join(", ")}.${created}${fixes}`,
    message: message("relatorioImportacao", {
      start: { date: period.start },
      end: { date: period.end },
      parts: sentences([
        message("frases.relImportacao", counts),
        ...(createdCategories.length > 0
          ? [
              message("frases.relImportacaoCriadas", {
                names: { categories: createdCategories },
              }),
            ]
          : []),
        ...(corrected > 0 ? [message("frases.relImportacaoCorrigiu", { count: corrected })] : []),
      ]),
    }),
    data: { rows: rows.length, bySource, corrected, createdCategories },
  };
}

// ----------------------------------------------------------------------------------------------
// Revisão diária de categorias (ADR-0015). O agente muda sozinho o que está em categoria genérica
// ou ficou "para revisar", e nada mais: não há sugestão de categoria para a família decidir.

/** Quem escolheu a categoria gravada no lançamento (`transactions.category_source`). */
export type TransactionCategorySource = "familia" | "importacao" | "revisar" | "agente";

export interface ReviewTransaction {
  id: string;
  kind: StatementKind;
  description: string;
  categoryId: string;
  categoryName: string;
  categorySource: TransactionCategorySource | null;
  importBatchId: string | null;
}

export interface ReviewInput {
  /** Lançamentos dos últimos 90 dias. */
  transactions: ReviewTransaction[];
  categories: CategoryOption[];
  /**
   * `history`: lançamentos cuja categoria não é genérica nem de sistema; `learned`:
   * `category_memory` com `source = 'familia'`.
   */
  memory: CategoryMemory;
  /** `category_memory` com `source = 'agente'`: vale quando regra e memória da família não sabem. */
  agentLearned?: Map<string, string>;
  /** `dedupe_key` de sugestões desfeitas: aquele estabelecimento nunca mais muda sozinho. */
  blocked: Set<string>;
  /** `dedupe_key` que a família mandou esperar: aquela mudança só volta depois de 30 dias. */
  ignored?: ReadonlySet<string>;
}

export interface ReviewGroup {
  /** Lançamentos a mover. Podem vir de mais de uma categoria; `fromCategoryId` é a mais comum. */
  ids: string[];
  kind: StatementKind;
  merchant: string;
  fromCategoryId: string;
  /** Null quando a proposta é criar a categoria. */
  toCategoryId: string | null;
  newCategory: { name: string; essential: boolean } | null;
  reason: string;
  /** `categoria:<kind>:<merchant>:<toCategoryId|new:<nome>>`. */
  dedupeKey: string;
}

export interface CategoryReview {
  /** O agente aplica e a família pode desfazer. */
  automatic: ReviewGroup[];
}

/**
 * Lançamento antigo sem `category_source`: com lote de importação e categoria fallback conta como
 * "revisar"; sem lote, foi a família.
 */
export function effectiveCategorySource(
  row: Pick<ReviewTransaction, "categorySource" | "categoryName" | "importBatchId">,
): TransactionCategorySource {
  if (row.categorySource) return row.categorySource;
  if (row.importBatchId && isFallbackCategory(row.categoryName)) return "revisar";
  return "familia";
}

/** `categoria:<tipo>:<estabelecimento>:...` vira a chave do estabelecimento; o resto, null. */
export function merchantOfDedupeKey(dedupeKey: string): string | null {
  const [prefix, kind, merchant] = dedupeKey.split(":");
  return prefix === "categoria" && kind && merchant ? `${kind}:${merchant}` : null;
}

/** Os estabelecimentos citados por uma lista de `dedupe_key`. */
export const merchantsOfDedupeKeys = (keys: Iterable<string>) =>
  new Set([...keys].flatMap((key) => merchantOfDedupeKey(key) ?? []));

export function categoryDedupeKey(
  kind: StatementKind,
  merchant: string,
  target: Pick<CategoryProposal, "categoryId" | "newCategory">,
): string {
  const to = target.categoryId ?? `new:${normalizeDescription(target.newCategory?.name ?? "")}`;
  return `categoria:${kind}:${merchant}:${to}`;
}

type GroupTarget = Pick<CategoryProposal, "categoryId" | "newCategory">;

const mostCommon = (values: string[]): string => {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
};

export function reviewCategories(input: ReviewInput): CategoryReview {
  const automatic: ReviewGroup[] = [];
  const byId = new Map(input.categories.map((category) => [category.id, category]));
  const blocked = merchantsOfDedupeKeys(input.blocked);
  const allowed = ({ categoryId, newCategory }: GroupTarget) => {
    const name = categoryId ? byId.get(categoryId)?.name : newCategory?.name;
    return name !== undefined && isCategoryTarget(name);
  };

  const groups = new Map<string, ReviewTransaction[]>();
  for (const row of input.transactions) {
    const merchant = merchantKey(row.description);
    if (!merchant || !isCategoryCandidate(row)) continue;
    const key = memoryKey(row.kind, merchant);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  for (const [key, rows] of groups) {
    if (blocked.has(key)) continue;
    const first = rows[0]!;
    const sample = { description: first.description, kind: first.kind };
    const proposal = categorizeRow(sample, input.categories, input.memory);
    const learned = input.agentLearned?.get(key);
    const learnedName = learned ? byId.get(learned) : undefined;

    let target: GroupTarget;
    let reason: string;
    if (allowed(proposal)) {
      target = proposal;
      reason = "A regra conhece o estabelecimento";
    } else if (learnedName?.kind === first.kind && isCategoryTarget(learnedName.name)) {
      target = { categoryId: learnedName.id, newCategory: null };
      reason = `O assistente já viu este estabelecimento em ${learnedName.name}`;
    } else continue;

    const moving = rows.filter((row) => row.categoryId !== target.categoryId);
    if (moving.length === 0) continue;
    const merchant = merchantKey(first.description);
    const dedupeKey = categoryDedupeKey(first.kind, merchant, target);
    if (input.ignored?.has(dedupeKey)) continue;
    automatic.push({
      ids: moving.map((row) => row.id),
      kind: first.kind,
      merchant,
      fromCategoryId: mostCommon(moving.map((row) => row.categoryId)),
      toCategoryId: target.categoryId,
      newCategory: target.newCategory,
      reason,
      dedupeKey,
    });
  }

  return { automatic };
}

export interface MergeCategoryOption extends CategoryOption {
  archived: boolean;
  /** Veio de `category_templates`: é destino preferido e nunca é fundida por palavras. */
  template: boolean;
}

export interface CategoryMerge {
  fromCategoryId: string;
  toCategoryId: string;
  reason: string;
}

const containsWords = (whole: string, part: string) =>
  part.length >= 3 && ` ${whole} `.includes(` ${part} `);

/**
 * Categorias que parecem a mesma coisa: mesmo tipo e nome igual ou contido, ou categoria da família
 * pouco usada (≤ 3 lançamentos em 90 dias) cujo nome casa com as palavras de outra existente. O
 * destino é a mais usada. O agente junta sozinho, com Desfazer. Categoria genérica e de sistema não
 * entram: "Outras despesas" é onde a importação cai, e aporte, meta, cartão, dívida e transferência têm
 * regra própria.
 */
export function suggestCategoryMerges(
  categories: MergeCategoryOption[],
  usage: Array<{ categoryId: string; count: number }>,
): CategoryMerge[] {
  const uses = new Map(usage.map((row) => [row.categoryId, row.count]));
  const useOf = (id: string) => uses.get(id) ?? 0;
  const active = categories.filter(
    (category) => !category.archived && isCategoryTarget(category.name),
  );
  const merges: CategoryMerge[] = [];
  const consumed = new Set<string>();

  const pick = (a: MergeCategoryOption, b: MergeCategoryOption) => {
    if (useOf(a.id) !== useOf(b.id)) return useOf(a.id) > useOf(b.id) ? [a, b] : [b, a];
    if (a.template !== b.template) return a.template ? [a, b] : [b, a];
    return a.name.localeCompare(b.name, "pt-BR") <= 0 ? [a, b] : [b, a];
  };

  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const a = active[i]!;
      const b = active[j]!;
      if (a.kind !== b.kind) continue;
      const nameA = normalizeDescription(a.name);
      const nameB = normalizeDescription(b.name);
      let reason: string | null = null;
      if (nameA === nameB || containsWords(nameA, nameB) || containsWords(nameB, nameA)) {
        reason = "Nomes iguais ou um contém o outro";
      } else {
        const matches = (small: MergeCategoryOption, big: MergeCategoryOption) => {
          if (small.template || useOf(small.id) > 3) return false;
          const padded = ` ${normalizeDescription(small.name)} `;
          const group = KEYWORDS[small.kind].find(({ words }) =>
            words.some((word) => padded.includes(word)),
          );
          return group !== undefined && sameName(group.category, big.name);
        };
        if (matches(a, b) || matches(b, a)) reason = "Nome casa com as palavras de outra categoria";
      }
      if (!reason) continue;
      const [to, from] = pick(a, b) as [MergeCategoryOption, MergeCategoryOption];
      if (consumed.has(from.id) || consumed.has(to.id)) continue;
      consumed.add(from.id);
      merges.push({ fromCategoryId: from.id, toCategoryId: to.id, reason });
    }
  }
  return merges;
}

// ----------------------------------------------------------------------------------------------
// Categorização com IA (ADR-0018). O modelo só opina: aqui se decide o que entra, o que a resposta
// pode virar e o que é recusado.

export type CategoryConfidence = "baixa" | "media" | "alta";

const normalizedSet = (names: string[]) => new Set(names.map(normalizeDescription));

/** Onde cai o que ninguém classificou de verdade. Comparado pelo nome normalizado. */
const GENERIC_NAMES = normalizedSet([
  FALLBACK.despesa,
  FALLBACK.receita,
  "Outros",
  "Outras",
  "Outros gastos",
  "Outras saídas",
  "Outras entradas",
  "Outros recebimentos",
  "Despesas diversas",
  "Receitas diversas",
  "Diversos",
  "Diversas",
  "Geral",
  "Gerais",
  "Sem categoria",
  "A classificar",
  "Não classificado",
  "Não categorizado",
]);

/** Categorias com regra própria no sistema: nada entra nem sai delas por classificação. */
const PROTECTED_NAMES = normalizedSet([
  GOAL_CATEGORY,
  CONTRIBUTION_CATEGORY,
  CARD_CATEGORY,
  DEBT_CATEGORY,
]);

export const isGenericCategory = (name: string) => GENERIC_NAMES.has(normalizeDescription(name));

export function isProtectedCategory(name: string): boolean {
  const normalized = normalizeDescription(name);
  return PROTECTED_NAMES.has(normalized) || normalized.startsWith("transferenc");
}

/** Categoria que pode receber lançamento por classificação. */
export const isCategoryTarget = (name: string) =>
  !isGenericCategory(name) && !isProtectedCategory(name);

export interface ImportedRedemptionGroup {
  ids: string[];
  merchant: string;
  fromCategoryId: string;
}

/**
 * Resgate que veio do extrato antes de existir a palavra e ficou em categoria genérica. Só esse muda
 * sozinho (ADR-0027): o que a família pôs em categoria específica, ou lançou à mão, fica. `blocked` traz os
 * estabelecimentos desfeitos, em `tipo:estabelecimento`. A categoria de aportes é protegida de toda
 * classificação; este é o único caminho que chega nela, por isso não passa por `reviewCategories`.
 */
export function importedRedemptionGroups(
  rows: ReviewTransaction[],
  blocked: ReadonlySet<string>,
): ImportedRedemptionGroup[] {
  const groups = new Map<string, ReviewTransaction[]>();
  for (const row of rows) {
    const merchant = merchantKey(row.description);
    const redemption = keywordGroup(row.description, "receita")?.category === CONTRIBUTION_CATEGORY;
    const imported = row.importBatchId !== null && isGenericCategory(row.categoryName);
    if (row.kind !== "receita" || !merchant || !redemption || !imported) continue;
    if (blocked.has(memoryKey(row.kind, merchant))) continue;
    groups.set(merchant, [...(groups.get(merchant) ?? []), row]);
  }
  return [...groups.entries()].map(([merchant, list]) => ({
    ids: list.map((row) => row.id),
    merchant,
    fromCategoryId: mostCommon(list.map((row) => row.categoryId)),
  }));
}

export type CandidateTransaction = ReviewTransaction & { amount: string };

/**
 * O que pode mudar sem a família pedir: categoria genérica, seja qual for a origem, ou marcada para
 * revisar em qualquer categoria. O que a família pôs numa categoria específica fica de fora.
 */
export function isCategoryCandidate(
  row: Pick<ReviewTransaction, "categoryName" | "categorySource" | "importBatchId">,
): boolean {
  if (isProtectedCategory(row.categoryName)) return false;
  return isGenericCategory(row.categoryName) || effectiveCategorySource(row) === "revisar";
}

export interface CategoryCandidate {
  kind: StatementKind;
  merchant: string;
  ids: string[];
  /** Uma descrição do grupo, como veio do extrato. Limpe antes de mandar ao modelo. */
  sample: string;
  fromCategoryId: string;
  count: number;
  total: string;
  average: string;
}

/**
 * Agrupa por estabelecimento e devolve os maiores valores primeiro, até `limit`. `closed` traz as
 * chaves `tipo:estabelecimento` que não entram: desfeitas, pendentes e sem resposta há pouco. Sem
 * isso, elas ficariam no topo toda noite e o resto do histórico nunca seria visto.
 */
export function categoryCandidates(
  rows: CandidateTransaction[],
  closed: ReadonlySet<string>,
  limit: number,
): CategoryCandidate[] {
  const groups = new Map<string, CandidateTransaction[]>();
  for (const row of rows) {
    const merchant = merchantKey(row.description);
    if (!merchant || !isCategoryCandidate(row)) continue;
    const key = memoryKey(row.kind, merchant);
    if (closed.has(key)) continue;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const candidates = [...groups.values()].map((group): CategoryCandidate => {
    const first = group[0]!;
    const total = group.reduce((sum, row) => sum.plus(row.amount), money(0));
    return {
      kind: first.kind,
      merchant: merchantKey(first.description),
      ids: group.map((row) => row.id),
      sample: first.description,
      fromCategoryId: mostCommon(group.map((row) => row.categoryId)),
      count: group.length,
      total: toDbAmount(total),
      average: toDbAmount(total.dividedBy(group.length)),
    };
  });
  return candidates
    .sort(
      (a, b) =>
        money(b.total).comparedTo(money(a.total)) ||
        a.merchant.localeCompare(b.merchant) ||
        a.kind.localeCompare(b.kind),
    )
    .slice(0, limit);
}

const MIN_NAME = 3;
const MAX_NAME = 40;
const MAX_NAME_WORDS = 4;

/** Nome curto, só letras: número, link e pontuação de código não viram categoria. */
export function validNewCategoryName(name: string): boolean {
  const trimmed = name.trim();
  return (
    trimmed.length >= MIN_NAME &&
    trimmed.length <= MAX_NAME &&
    /^\p{L}[\p{L} ,&-]*$/u.test(trimmed) &&
    trimmed.split(/\s+/).length <= MAX_NAME_WORDS &&
    !isGenericCategory(trimmed) &&
    !isProtectedCategory(trimmed)
  );
}

const CONNECTORS = new Set(["e", "de", "do", "da", "dos", "das"]);

/** Sem acento, conectivos e plural, para "Pet" e "Pets" serem o mesmo nome. */
const looseName = (name: string) =>
  normalizeDescription(name)
    .split(" ")
    .filter((word) => !CONNECTORS.has(word))
    .map((word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word))
    .join(" ");

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    previous = current;
  }
  return previous[b.length]!;
}

/** Erro de digitação: um caractere em nome médio, dois em nome longo. */
const typoLimit = (length: number) => (length >= 10 ? 2 : length >= 6 ? 1 : 0);

/** A categoria que já cobre este nome: nome igual primeiro, depois contido ou quase igual. */
export function nearDuplicateCategory<T extends { name: string }>(
  name: string,
  options: readonly T[],
): T | null {
  const wanted = looseName(name);
  const near = (option: T) => {
    const other = looseName(option.name);
    return (
      containsWords(wanted, other) ||
      containsWords(other, wanted) ||
      editDistance(wanted, other) <= typoLimit(Math.min(wanted.length, other.length))
    );
  };
  return options.find((option) => looseName(option.name) === wanted) ?? options.find(near) ?? null;
}

export interface CategoryAnswer {
  /** Número do grupo enviado, a partir de 1. */
  grupo: number;
  categoria: string | null;
  novaCategoria: string | null;
  essencial: boolean;
  confianca: CategoryConfidence;
}

export interface CategoryMove {
  group: CategoryCandidate;
  target: Pick<CategoryProposal, "categoryId" | "newCategory">;
  confidence: CategoryConfidence;
}

export interface CategoryPlan {
  moves: CategoryMove[];
  /** O modelo não soube dizer. */
  unknown: CategoryCandidate[];
  /** A resposta não passou nas regras. */
  rejected: CategoryCandidate[];
  /** Passou do limite de categorias novas da noite: fica para a próxima. */
  deferred: number;
}

export interface CategoryPlanInput {
  groups: CategoryCandidate[];
  answers: CategoryAnswer[];
  /** Categorias ativas, com os nomes como foram ao modelo. */
  categories: CategoryOption[];
  maxNew: number;
  /** Conferência extra de um nome novo, como nome de pessoa. */
  nameAllowed?: (name: string) => boolean;
}

type PlannedCategory = CategoryOption & { essential: boolean };

/** Transforma a resposta em movimentos válidos. Nada que o modelo devolva escapa destas regras. */
export function planCategoryMoves(input: CategoryPlanInput): CategoryPlan {
  const plan: CategoryPlan = { moves: [], unknown: [], rejected: [], deferred: 0 };
  const planned: PlannedCategory[] = [];
  const seen = new Set<number>();

  for (const answer of input.answers) {
    const group = input.groups[answer.grupo - 1];
    if (!group || seen.has(answer.grupo)) continue;
    seen.add(answer.grupo);
    const options = input.categories.filter((category) => category.kind === group.kind);
    const move = (target: CategoryMove["target"]) =>
      plan.moves.push({ group, target, confidence: answer.confianca });

    if (answer.categoria !== null) {
      const wanted = answer.categoria;
      const known = options.find((category) => sameName(category.name, wanted));
      if (isGenericCategory(wanted)) plan.unknown.push(group);
      else if (!known || isProtectedCategory(known.name)) plan.rejected.push(group);
      else move({ categoryId: known.id, newCategory: null });
      continue;
    }

    const name = answer.novaCategoria?.trim() ?? "";
    if (!name || isGenericCategory(name)) {
      plan.unknown.push(group);
      continue;
    }
    if (!validNewCategoryName(name) || input.nameAllowed?.(name) === false) {
      plan.rejected.push(group);
      continue;
    }
    const sameKind = planned.filter((category) => category.kind === group.kind);
    const near = nearDuplicateCategory<CategoryOption | PlannedCategory>(name, [
      ...options,
      ...sameKind,
    ]);
    if (near && (isGenericCategory(near.name) || isProtectedCategory(near.name))) {
      plan.rejected.push(group);
    } else if (near) {
      const essential = "essential" in near ? near.essential : false;
      move(
        near.id
          ? { categoryId: near.id, newCategory: null }
          : { categoryId: null, newCategory: { name: near.name, essential } },
      );
    } else if (planned.length >= input.maxNew) {
      plan.deferred += 1;
    } else {
      planned.push({ id: "", kind: group.kind, name, essential: answer.essencial });
      move({ categoryId: null, newCategory: { name, essential: answer.essencial } });
    }
  }
  return plan;
}

/** O que a etapa de IA fez no dia. */
export interface ReportCategoriasIa {
  /** Estabelecimentos enviados ao modelo. */
  groups: number;
  moved: number;
  created: string[];
  /** Sem resposta aproveitável ou com pouca confiança: ficam de fora por 30 dias. */
  skipped: number;
}

export interface ReportCategorias {
  reviewed: number;
  moved: number;
  created: string[];
  merges: number;
  ia?: ReportCategoriasIa;
}

export interface DailyCategoryReport {
  title: string;
  summary: string;
  /** O mesmo relatório, por chave, para sair no idioma de quem lê. */
  message: Message;
  data: ReportCategorias;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const AI_MARK = "Pela descrição do extrato:";

/** Acrescenta ao resumo do dia o que a IA fez, trocando o trecho anterior, se houver. */
export function withAiSummary(summary: string, ia: ReportCategoriasIa): string {
  const created = ia.created.length > 0 ? ` Categorias criadas: ${ia.created.join(", ")}.` : "";
  const base = summary.split(AI_MARK)[0]!.trimEnd();
  return (
    `${base} ${AI_MARK} ${plural(ia.moved, "lançamento movido", "lançamentos movidos")}.` + created
  );
}

/** O relatório do dia, por chave. O dia vai na chave porque a etapa de IA soma depois. */
export function categoryReportMessage(
  counts: ReportCategorias,
  day: string,
): Message<"relatorioCategorias"> {
  const created = (names: string[]) =>
    names.length > 0
      ? [message("frases.relCategoriasCriadas", { names: { categories: names } })]
      : [];
  return message("relatorioCategorias", {
    day: { date: day },
    parts: sentences([
      message("frases.relCategorias", {
        reviewed: counts.reviewed,
        moved: counts.moved,
        merges: counts.merges,
      }),
      ...created(counts.created),
      ...(counts.ia
        ? [
            message("frases.relCategoriasIa", { moved: counts.ia.moved }),
            ...created(counts.ia.created),
          ]
        : []),
    ]),
  });
}

/** Relatório do dia do agente de categorias, para `household_reports` (kind `categorias`). */
export function dailyCategoryReport(counts: {
  reviewed: number;
  moved: number;
  merges: number;
  created: string[];
  day?: string;
  ia?: ReportCategoriasIa;
}): DailyCategoryReport {
  const created =
    counts.created.length > 0 ? ` Categorias criadas: ${counts.created.join(", ")}.` : "";
  const summary =
    `${plural(counts.reviewed, "lançamento revisado", "lançamentos revisados")}, ` +
    `${plural(counts.moved, "movido sozinho", "movidos sozinhos")}, ` +
    `${plural(counts.merges, "fusão feita", "fusões feitas")}.${created}`;
  const data: ReportCategorias = {
    reviewed: counts.reviewed,
    moved: counts.moved,
    created: counts.created,
    merges: counts.merges,
    ...(counts.ia ? { ia: counts.ia } : {}),
  };
  return {
    title: counts.day ? `Categorias revisadas em ${counts.day}` : "Revisão de categorias",
    summary: counts.ia ? withAiSummary(summary, counts.ia) : summary,
    message: categoryReportMessage(data, counts.day ?? ""),
    data,
  };
}
