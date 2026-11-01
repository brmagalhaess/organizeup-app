import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { canWrite } from "@organizeup/db";
import { requireTenant } from "@/lib/session";
import { loadSuggestions } from "@/lib/suggestions";
import { SuggestionsBoard } from "./suggestions-board";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sugestoes");
  return { title: t("metaTitle") };
}

export default async function SuggestionsPage() {
  const { ctx } = await requireTenant();
  const data = await loadSuggestions(ctx);
  return <SuggestionsBoard data={data} writable={canWrite(ctx)} />;
}
