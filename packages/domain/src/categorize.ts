// Agente de categorização do extrato. Puro: recebe a memória da família e devolve uma proposta por
// linha. Nada é gravado aqui, e a família revisa tudo antes de importar (AGENTS.md, regra 7).
// O texto do extrato é dado não confiável: só serve para comparar palavras.
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

interface KeywordGroup {
  category: string;
  words: string[];
  /** Vale ao criar a categoria. */
  essential?: boolean;
}

/** Palavras frequentes em extratos. Da mais específica para a mais geral. */
const KEYWORDS: Record<StatementKind, KeywordGroup[]> = {
  despesa: [
    {
      category: "Mercado",
      essential: true,
      words: [
        "mercado",
        "supermerc",
        "atacad",
        "assai",
        "carrefour",
        "hortifruti",
        "pao de acucar",
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
        "vivo",
        "claro",
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
      ],
    },
    {
      category: "Saúde",
      essential: true,
      words: [
        "farmacia",
        "drogaria",
        "droga",
        "unimed",
        "amil",
        "hospital",
        "clinica",
        "laboratorio",
        "dentista",
      ],
    },
    { category: "Moradia", essential: true, words: ["aluguel", "condominio", "iptu"] },
    {
      category: "Educação",
      essential: true,
      words: ["escola", "colegio", "faculdade", "universidade", "curso", "mensalidade"],
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
      ],
    },
    { category: "Lazer", words: ["cinema", "ingresso", "bar ", "teatro", "show "] },
    {
      category: "Compras",
      words: ["magazine", "mercado livre", "shopee", "amazon", "americanas", "renner"],
    },
    { category: "Pets", words: ["petz", "cobasi", "petshop", "pet shop", "veterinari"] },
    {
      category: "Tarifas bancárias",
      words: ["tarifa", "anuidade", "iof", "cesta de servicos", "pacote de servicos"],
    },
    {
      category: "Impostos e taxas",
      essential: true,
      words: ["ipva", "darf", "receita federal", "detran", "licenciamento"],
    },
    { category: "Seguros", essential: true, words: ["seguro", "seguradora"] },
    {
      category: "Cuidados pessoais",
      words: ["salao", "barbearia", "cabeleireiro", "boticario", "perfumaria"],
    },
    { category: "Academia", words: ["academia", "smartfit", "smart fit"] },
    { category: "Viagens", words: ["hotel", "airbnb", "booking", "latam", "decolar", "passagem"] },
  ],
  receita: [
    { category: "Salário", words: ["salario", "folha", "vencimentos"] },
    { category: "Rendimentos", words: ["rendimento", "dividendo", "juros"] },
    { category: "Aluguel recebido", words: ["aluguel"] },
    { category: "Reembolsos", words: ["estorno", "reembolso", "cashback", "devolucao"] },
  ],
};

const FALLBACK: Record<StatementKind, string> = {
  despesa: "Outras despesas",
  receita: "Outras receitas",
};

/** Palavras que dizem como o dinheiro passou, não para quem. */
const NOISE = new Set(
  (
    "pix transf transferencia transferido enviado enviada recebido recebida ted doc compra compras " +
    "cartao debito credito pagamento pagto pag boleto deb aut automatico autorizada no na em de do da " +
    "dos das para qr code"
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

  const name = ` ${normalizeDescription(row.description)} `;
  const group = KEYWORDS[row.kind].find(({ words }) => words.some((word) => name.includes(word)));
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
  return {
    title: `Extrato de ${period.start} a ${period.end}`,
    summary: `${parts.join(", ")}.${created}${fixes}`,
    data: { rows: rows.length, bySource, corrected, createdCategories },
  };
}
