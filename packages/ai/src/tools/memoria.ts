// Conhecimento e memória (§3). `buscar_conhecimento` lê a base global, com fonte. `salvar_memoria`
// anota o que a família disse na conversa: não é dado financeiro informado nem derivado (regra 7), por
// isso grava direto, e a família vê e apaga em Configurações. Número nunca entra aqui: número vem das
// ferramentas, e uma anotação velha não pode competir com o saldo de hoje.
import {
  householdCurrency,
  householdMemories,
  inArray,
  MEMORY_KINDS,
  searchKnowledge,
} from "@organizeup/db";
import { brazilRulesApply } from "@organizeup/domain";
import { z } from "zod";
import { INSTRUCTION } from "../insights/verify";
import {
  activeOfKind,
  countActive,
  MAX_ACTIVE_MEMORIES,
  memoryWords,
  similarMemories,
} from "../memories";
import { loadPrivacyFilter } from "../privacy";
import { defineTool, read } from "./registry";

const MAX_TEXT = 300;

/** Valor em dinheiro, com número ou por extenso. Ano e idade passam: "aos 60 anos", "em 2040". */
const MONEY =
  /R\$|US\$|€|\b(?:reais|d[óo]lar(?:es)?|euros?|centavos?|mil|milh(?:ão|ao|ões|oes)|bilh(?:ão|ao|ões|oes))\b|\d\s?k\b|\d\s*(?:por|ao|\/)\s*m[êe]s|\d,\d{2}\b|\d{1,3}(?:\.\d{3})+|\b(?!(?:19|20)\d{2}\b)\d{4,}\b/i;

export const mentionsMoney = (text: string) => MONEY.test(text);

const OUTSIDE_BRAZIL =
  "Esta base é do Brasil, e a moeda principal da família é outra: diga que a regra é brasileira e pode não valer para ela.";

const buscarConhecimento = defineTool({
  name: "buscar_conhecimento",
  module: null,
  description:
    "Busca na base conferida as regras de INSS, imposto de renda, FGC, previdência, FII, dividendos, reserva de emergência, inflação e diversificação. Chame antes de explicar qualquer regra desses assuntos. Devolve até 3 trechos, cada um com fonte e data de revisão, e essa fonte precisa ser citada na resposta.",
  kind: "leitura",
  input: z.strictObject({
    pergunta: z.string().min(2).max(300).describe("O que procurar, em português."),
  }),
  label: () => "olhei as regras oficiais",
  run: async (ctx, { pergunta }) => {
    const rows = await searchKnowledge(pergunta);
    if (rows.length === 0) {
      return {
        encontrados: 0,
        aviso: "Não há trecho conferido sobre isso. Diga que não tem uma fonte para citar.",
      };
    }
    const brazil = brazilRulesApply(await read(ctx, (tx) => householdCurrency(tx)));
    return {
      ...(brazil ? {} : { aviso: OUTSIDE_BRAZIL }),
      encontrados: rows.length,
      trechos: rows.map((row) => ({
        titulo: row.title,
        texto: row.content,
        fonte: row.sourceName,
        endereco: row.sourceUrl,
        revisado_em: row.reviewedOn,
      })),
    };
  },
});

const salvarMemoria = defineTool({
  name: "salvar_memoria",
  module: null,
  description:
    "Anota algo durável sobre a família: uma preferência, um objetivo ou um fato. Chame só quando a pessoa disser isso na conversa e pedir para lembrar ou concordar com a anotação. Nunca anote valor em dinheiro nem nome de pessoa. Escreva em uma frase curta, como dado sobre a família. Anotação parecida com uma já existente substitui a antiga.",
  kind: "escrita",
  input: z.strictObject({
    tipo: z.enum(MEMORY_KINDS),
    texto: z.string().trim().min(3).max(MAX_TEXT).describe("A anotação, em uma frase curta."),
  }),
  label: () => "deixei anotado para lembrar depois",
  run: (ctx, { tipo, texto }) =>
    read(ctx, async (tx, today) => {
      if (mentionsMoney(texto)) {
        return {
          feito: false,
          motivo: "Valor em dinheiro não entra em anotação: número vem das ferramentas.",
        };
      }
      if (INSTRUCTION.test(texto)) {
        return { feito: false, motivo: "Anotação é fato sobre a família, não um pedido ou link." };
      }
      const privacy = await loadPrivacyFilter(tx, ctx.householdId);
      const content = privacy.scrub(texto);
      if (content.length > MAX_TEXT) {
        return { feito: false, motivo: "Ficou longa demais. Use uma frase mais curta." };
      }
      const words = await memoryWords(tx, content);
      if (words.length === 0) {
        return { feito: false, motivo: "Ficou vaga demais. Escreva o que deve ser lembrado." };
      }
      const similar = similarMemories(await activeOfKind(tx, tipo, today), words);
      const active = await countActive(tx, today);
      if (active - similar.length >= MAX_ACTIVE_MEMORIES) {
        return {
          feito: false,
          motivo:
            "Já há muitas anotações. Peça à pessoa para apagar alguma em Configurações, no bloco O que o assistente sabe.",
        };
      }
      const [created] = await tx
        .insert(householdMemories)
        .values({
          householdId: ctx.householdId,
          kind: tipo,
          content,
          source: "conversa",
          createdBy: ctx.userId,
        })
        .returning({ id: householdMemories.id });
      if (similar.length > 0) {
        await tx
          .update(householdMemories)
          .set({ supersededBy: created!.id })
          .where(inArray(householdMemories.id, similar));
      }
      return {
        feito: true,
        substituiu_anotacao_antiga: similar.length > 0,
        aviso: "Anotado. A família pode ver e apagar em Configurações.",
      };
    }),
});

export const KNOWLEDGE_TOOLS = [buscarConhecimento];
export const MEMORY_TOOLS = [salvarMemoria];
