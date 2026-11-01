// Base de conhecimento do assistente (ADR-0018). Global, sem dado de família e sem RLS de tenant: roda
// fora de withHousehold, como os helpers de mercado.
import { desc, sql } from "drizzle-orm";
import { tolerateSchemaLag } from "./access";
import { appPool } from "./client";
import { knowledgeChunks } from "./schema";

const MAX_FOUND = 3;

/**
 * Pergunta em linguagem natural: `websearch_to_tsquery` aceita qualquer texto sem erro de sintaxe, e o
 * texto vai como parâmetro. Ela liga as palavras com E, o que deixaria quase toda pergunta sem
 * resposta; com OU, o trecho que tem mais palavras da pergunta sobe no `ts_rank`.
 */
const queryOf = (text: string) =>
  sql`replace(websearch_to_tsquery('portuguese', sem_acento(${text}))::text, ' & ', ' | ')::tsquery`;

/** Até 3 trechos, do mais próximo ao mais distante. Sem a tabela, lista vazia. */
export function searchKnowledge(text: string) {
  const query = queryOf(text);
  return tolerateSchemaLag(
    () =>
      appPool()
        .db.select({
          title: knowledgeChunks.title,
          content: knowledgeChunks.content,
          sourceName: knowledgeChunks.sourceName,
          sourceUrl: knowledgeChunks.sourceUrl,
          reviewedOn: knowledgeChunks.reviewedOn,
        })
        .from(knowledgeChunks)
        .where(sql`knowledge_chunks.search @@ ${query}`)
        .orderBy(desc(sql`ts_rank(knowledge_chunks.search, ${query})`), knowledgeChunks.slug)
        .limit(MAX_FOUND),
    [],
  );
}
