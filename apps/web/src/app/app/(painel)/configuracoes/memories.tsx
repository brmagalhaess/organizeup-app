import { listMemories, type MemoryRow } from "@organizeup/ai";
import { canWrite, type TenantContext } from "@organizeup/db";
import { todayIn } from "@organizeup/domain";
import { EmptyState, FormMessage } from "@/components/ui";
import { MemoryList } from "./memory-list";

const KIND_LABEL: Record<MemoryRow["kind"], string> = {
  fato: "Fato",
  preferencia: "Preferência",
  objetivo: "Objetivo",
};

async function load(ctx: TenantContext): Promise<MemoryRow[] | null> {
  try {
    return await listMemories(ctx);
  } catch {
    return null;
  }
}

/** Bloco "O que o assistente sabe". Quem só vê lê a lista, sem os botões de apagar. */
export async function MemoriesBlock({ ctx }: { ctx: TenantContext }) {
  const memories = await load(ctx);
  if (!memories) {
    return <FormMessage message="Não foi possível carregar as anotações. Tente de novo." />;
  }
  if (memories.length === 0) {
    return (
      <EmptyState
        title="Nada anotado ainda"
        text="Quando você pedir na conversa para o assistente lembrar de algo, a anotação aparece aqui."
      />
    );
  }
  const today = todayIn();
  return (
    <MemoryList
      canDelete={canWrite(ctx)}
      memories={memories.map((memory) => ({
        id: memory.id,
        kind: KIND_LABEL[memory.kind],
        content: memory.content,
        createdOn: memory.createdAt.toLocaleDateString("pt-BR"),
        expired: memory.expiresOn !== null && memory.expiresOn < today,
      }))}
    />
  );
}
