import type { Metadata } from "next";
import { canWrite } from "@organizeup/db";
import { requireTenant } from "@/lib/session";
import { loadSuggestions } from "@/lib/suggestions";
import { SuggestionsBoard } from "./suggestions-board";

export const metadata: Metadata = { title: "Sugestões" };

export default async function SuggestionsPage() {
  const { ctx } = await requireTenant();
  const data = await loadSuggestions(ctx);
  return <SuggestionsBoard data={data} writable={canWrite(ctx)} />;
}
