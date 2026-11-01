// Ferramentas que organizam (§2 e §4). Nenhuma mexe direto no dado da família: todas criam uma sugestão
// em `household_suggestions`, regra 7. Só duas podem aplicar sozinhas, conforme o nível de autonomia,
// sempre com Desfazer e com limite por dia: categoria de lançamento que ficou "para revisar" (dado
// derivado) e meta em rascunho, no nível Completo.
import { applySuggestion, DEDUPE, parsePayload, type MetaPayload } from "@organizeup/agents";
import {
  and,
  categories,
  eq,
  goals,
  gte,
  householdSettings,
  householdSuggestions,
  lte,
  sql,
  transactions,
  type SuggestionKind,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";
import {
  formatBRL,
  monthBounds,
  normalizeDescription,
  toDbAmount,
  yearMonthOf,
} from "@organizeup/domain";
import { z } from "zod";
import { amountInput, defineTool, monthInput, read } from "./registry";

export const ASSISTANT_AGENT = "assistente";
/** Alterações que o assistente pode fazer sozinho por dia, em cada família. */
export const MAX_AUTOMATIC_PER_DAY = 5;
const MAX_TITLE = 120;
const MAX_BODY = 800;
const MAX_LINES = 200;

const SCREEN_LINKS = {
  painel: "/app",
  lancamentos: "/app/lancamentos",
  calendario: "/app/calendario",
  metas: "/app/metas",
  viagens: "/app/viagens",
  investimentos: "/app/investimentos",
  proventos: "/app/proventos",
  aposentadoria: "/app/aposentadoria",
  reserva: "/app/reserva",
  dividas: "/app/dividas",
} as const;
type Screen = keyof typeof SCREEN_LINKS;

const PENDING = "Deixei na tela Sugestões. Nada mudou até a família aceitar.";

interface Proposal {
  kind: SuggestionKind;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
}

/** Cria a sugestão pendente. Se já existe uma igual esperando decisão, usa a que está lá. */
async function propose(tx: TenantTx, ctx: TenantContext, item: Proposal): Promise<string> {
  const dedupeKey = item.dedupeKey.slice(0, 160);
  const [existing] = await tx
    .select({ id: householdSuggestions.id })
    .from(householdSuggestions)
    .where(
      and(
        eq(householdSuggestions.status, "pendente"),
        eq(householdSuggestions.dedupeKey, dedupeKey),
      ),
    );
  if (existing) return existing.id;
  const [row] = await tx
    .insert(householdSuggestions)
    .values({
      householdId: ctx.householdId,
      agent: ASSISTANT_AGENT,
      kind: item.kind,
      title: item.title.slice(0, MAX_TITLE),
      body: item.body.slice(0, MAX_BODY),
      payload: item.payload,
      dedupeKey,
    })
    .returning({ id: householdSuggestions.id });
  return row!.id;
}

async function autonomyOf(tx: TenantTx) {
  const [row] = await tx.select({ level: householdSettings.aiAutonomy }).from(householdSettings);
  return row?.level ?? "sugerir";
}

async function canActAlone(tx: TenantTx, today: string): Promise<boolean> {
  const [row] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(householdSuggestions)
    .where(
      and(
        eq(householdSuggestions.agent, ASSISTANT_AGENT),
        eq(householdSuggestions.appliedBy, "agente"),
        sql`(${householdSuggestions.decidedAt})::date = ${today}`,
      ),
    );
  return (row?.total ?? 0) < MAX_AUTOMATIC_PER_DAY;
}

/** Aplica pela mesma rota da família e marca que quem aplicou foi o assistente. */
async function applyAlone(tx: TenantTx, ctx: TenantContext, id: string): Promise<boolean> {
  const result = await applySuggestion(tx, ctx, id);
  if (!result.ok) return false;
  await tx
    .update(householdSuggestions)
    .set({ appliedBy: "agente" })
    .where(eq(householdSuggestions.id, id));
  return true;
}

const sugerirCategoria = defineTool({
  name: "sugerir_categoria",
  description:
    "Propõe mover lançamentos de um mês para uma categoria. Chame só quando a pessoa pedir ou concordar. Lançamento que ficou para revisar pode mudar na hora, conforme o nível de autonomia e com Desfazer; os demais ficam como sugestão. Use o nome da categoria como em listar_categorias.",
  kind: "escrita",
  input: z.strictObject({
    busca: z.string().min(3).max(80).describe("Parte da descrição dos lançamentos."),
    categoria: z.string().min(1).max(60).describe("Nome da categoria de destino."),
    mes: monthInput,
  }),
  label: () => "organizei uma categoria",
  run: (ctx, input) =>
    read(ctx, async (tx, today) => {
      const { first, last } = monthBounds(input.mes ?? yearMonthOf(today));
      const rows = await tx
        .select()
        .from(transactions)
        .where(and(gte(transactions.occurredOn, first), lte(transactions.occurredOn, last)));
      const wanted = normalizeDescription(input.busca);
      const lines = rows
        .filter((row) => normalizeDescription(row.description).includes(wanted))
        .slice(0, MAX_LINES);
      const sample = lines[0];
      if (!sample) return { feito: false, motivo: "Não achei lançamentos com essa descrição." };

      const names = await tx
        .select({ id: categories.id, name: categories.name, kind: categories.kind })
        .from(categories)
        .where(eq(categories.archived, false));
      const target = normalizeDescription(input.categoria);
      const category = names.find(
        (row) => row.kind === sample.kind && normalizeDescription(row.name) === target,
      );
      const same = lines.filter((row) => row.kind === sample.kind);
      const id = await propose(tx, ctx, {
        kind: "categoria",
        title: `Mover para ${input.categoria}`,
        body: `${same.length} lançamento(s) com "${input.busca}" vão para ${input.categoria}.`,
        payload: {
          kind: sample.kind,
          transactionIds: same.map((row) => row.id),
          fromCategoryId: sample.categoryId,
          toCategoryId: category?.id ?? null,
          newCategory: category ? null : { name: input.categoria, essential: false },
          merchant: wanted.slice(0, 120),
        },
        dedupeKey: DEDUPE.categoria(sample.kind, wanted, category?.id ?? { newName: target }),
      });
      const derived = same.every((row) => row.categorySource === "revisar");
      const allowed = derived && (await autonomyOf(tx)) !== "sugerir";
      if (allowed && (await canActAlone(tx, today)) && (await applyAlone(tx, ctx, id))) {
        return {
          feito: true,
          lancamentos: same.length,
          aviso: "Já movi. A família pode desfazer em Sugestões.",
        };
      }
      return { feito: false, lancamentos: same.length, aviso: PENDING };
    }),
});

const sugerirAporte = defineTool({
  name: "sugerir_aporte",
  description:
    "Propõe mudar quanto a família guarda por mês na reserva ou na aposentadoria. Chame só quando a pessoa pedir ou concordar. É sempre uma sugestão: o valor só muda quando a família aceitar.",
  kind: "escrita",
  input: z.strictObject({
    destino: z.enum(["reserva", "aposentadoria"]),
    valor_mensal: amountInput("Quanto guardar por mês."),
  }),
  label: () => "deixei uma sugestão de quanto guardar",
  run: (ctx, { destino, valor_mensal }) =>
    read(ctx, async (tx, today) => {
      const month = yearMonthOf(today);
      const monthlyAmount = toDbAmount(valor_mensal);
      const reserve = destino === "reserva";
      await propose(tx, ctx, {
        kind: reserve ? "aporte_reserva" : "aporte_investimento",
        title: reserve ? "Guardar na reserva todo mês" : "Guardar para a aposentadoria todo mês",
        body: `Combinado na conversa com o assistente: ${formatBRL(monthlyAmount)} por mês.`,
        payload: { monthlyAmount, previous: null },
        dedupeKey: reserve ? DEDUPE.aporteReserva(month) : DEDUPE.aporteInvestimento(month),
      });
      return { feito: false, aviso: PENDING };
    }),
});

const sugerirDataMeta = defineTool({
  name: "sugerir_data_meta",
  description:
    "Propõe mudar o mês desejado de uma meta. Chame só quando a pessoa pedir ou concordar. É sempre uma sugestão: a data que a família informou só muda quando ela aceitar.",
  kind: "escrita",
  input: z.strictObject({
    meta: z.string().min(1).max(120).describe("Nome da meta, como aparece em listar_metas."),
    mes: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use o formato AAAA-MM.")
      .describe("Novo mês desejado, no formato AAAA-MM."),
  }),
  label: () => "deixei uma sugestão para a sua meta",
  run: (ctx, { meta, mes }) =>
    read(ctx, async (tx, today) => {
      const rows = await tx.select().from(goals);
      const wanted = normalizeDescription(meta);
      const goal = rows.find((row) => normalizeDescription(row.name).includes(wanted));
      if (!goal) return { feito: false, motivo: "Não achei essa meta." };
      const payload: MetaPayload = { goalId: goal.id, proposedMonth: mes, extraMonthly: null };
      await propose(tx, ctx, {
        kind: "meta",
        title: `Nova data para ${goal.name}`,
        body: `Mudar o mês desejado de ${goal.name} para ${mes}.`,
        payload,
        dedupeKey: DEDUPE.meta(goal.id, yearMonthOf(today)),
      });
      return { feito: false, aviso: PENDING };
    }),
});

const criarMetaRascunho = defineTool({
  name: "criar_meta_rascunho",
  description:
    "Cria uma meta nova em rascunho. Chame só quando a pessoa pedir. No nível de autonomia Completo a meta aparece na hora, com Desfazer; nos outros, fica como sugestão.",
  kind: "escrita",
  input: z.strictObject({
    nome: z.string().min(1).max(80),
    valor: amountInput("Valor total da meta."),
    mes: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use o formato AAAA-MM.")
      .optional()
      .describe("Mês desejado, no formato AAAA-MM."),
  }),
  label: () => "preparei uma meta em rascunho",
  run: (ctx, { nome, valor, mes }) =>
    read(ctx, async (tx, today) => {
      const payload = parsePayload("meta", {
        goalId: "nova",
        proposedMonth: mes ?? null,
        extraMonthly: null,
        draft: { name: nome, targetAmount: toDbAmount(valor), desiredMonth: mes ?? null },
      });
      const id = await propose(tx, ctx, {
        kind: "meta",
        title: `Criar a meta ${nome}`,
        body: `Meta de ${formatBRL(toDbAmount(valor))}, proposta na conversa com o assistente.`,
        payload,
        dedupeKey: DEDUPE.metaNova(normalizeDescription(nome)),
      });
      const allowed = (await autonomyOf(tx)) === "completo";
      if (allowed && (await canActAlone(tx, today)) && (await applyAlone(tx, ctx, id))) {
        return { feito: true, aviso: "Meta criada. A família pode desfazer em Sugestões." };
      }
      return { feito: false, aviso: PENDING };
    }),
});

const criarLembrete = defineTool({
  name: "criar_lembrete",
  description:
    "Deixa um lembrete na tela Sugestões, com link para a tela onde a pessoa resolve. Chame quando a pessoa pedir para não esquecer de algo.",
  kind: "escrita",
  input: z.strictObject({
    titulo: z.string().min(1).max(100),
    texto: z.string().min(1).max(400),
    tela: z.enum(Object.keys(SCREEN_LINKS) as [Screen, ...Screen[]]),
  }),
  label: () => "criei um lembrete",
  run: (ctx, { titulo, texto, tela }) =>
    read(ctx, async (tx) => {
      await propose(tx, ctx, {
        kind: "lembrete",
        title: titulo,
        body: texto,
        payload: { href: SCREEN_LINKS[tela] },
        dedupeKey: `lembrete:assistente:${normalizeDescription(titulo)}`,
      });
      return { feito: true, aviso: "Lembrete criado em Sugestões." };
    }),
});

export const WRITE_TOOLS = [
  criarLembrete,
  criarMetaRascunho,
  sugerirAporte,
  sugerirCategoria,
  sugerirDataMeta,
];
