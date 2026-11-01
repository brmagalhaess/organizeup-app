// Baixa um arquivo de dívida. A RLS de `withHousehold` garante que só a própria família acha o arquivo.
// Sempre como anexo e com tipo fixo, para o navegador nunca abrir nem interpretar o que foi enviado.
import { loadDebtDocumentFile } from "@organizeup/agents";
import { withHousehold } from "@organizeup/db";
import { requireTenant } from "@/lib/session";

export const dynamic = "force-dynamic";

/** `filename` simples para navegador antigo, e `filename*` com o nome inteiro em UTF-8. */
function disposition(name: string): string {
  const plain = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireTenant();
  const { id } = await params;
  const file = await withHousehold(ctx, (tx) => loadDebtDocumentFile(tx, id));
  if (!file) return new Response(null, { status: 404 });
  return new Response(Buffer.from(file.content), {
    headers: {
      "Content-Type": file.mediaType,
      "Content-Disposition": disposition(file.fileName),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
