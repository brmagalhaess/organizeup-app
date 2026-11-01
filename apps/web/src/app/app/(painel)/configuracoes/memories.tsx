import { listMemories, type MemoryRow } from "@organizeup/ai";
import { canWrite, type TenantContext } from "@organizeup/db";
import { todayIn } from "@organizeup/domain";
import { getLocale, getTranslations } from "next-intl/server";
import { EmptyState, FormMessage } from "@/components/ui";
import { formatInstant } from "@/i18n/format";
import { MemoryList } from "./memory-list";

const KIND_KEY = {
  fato: "kindFato",
  preferencia: "kindPreferencia",
  objetivo: "kindObjetivo",
} as const satisfies Record<MemoryRow["kind"], string>;

async function load(ctx: TenantContext): Promise<MemoryRow[] | null> {
  try {
    return await listMemories(ctx);
  } catch {
    return null;
  }
}

/** Bloco "O que o assistente sabe". Quem só vê lê a lista, sem os botões de apagar. */
export async function MemoriesBlock({ ctx }: { ctx: TenantContext }) {
  const [memories, t, locale] = await Promise.all([
    load(ctx),
    getTranslations("settings.memories"),
    getLocale(),
  ]);
  if (!memories) return <FormMessage message={t("loadFailed")} />;
  if (memories.length === 0) {
    return <EmptyState title={t("emptyTitle")} text={t("emptyText")} />;
  }
  const today = todayIn();
  return (
    <MemoryList
      canDelete={canWrite(ctx)}
      memories={memories.map((memory) => ({
        id: memory.id,
        kind: t(KIND_KEY[memory.kind]),
        content: memory.content,
        createdOn: formatInstant(memory.createdAt, locale),
        expired: memory.expiresOn !== null && memory.expiresOn < today,
      }))}
    />
  );
}
