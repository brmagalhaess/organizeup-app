// Baixa um arquivo do importador. Sempre anexo, com `nosniff` e `no-store`: o navegador nunca abre o que foi
// enviado. A RLS diz de quem é. Quem só vê também baixa, como nos anexos de dívida.
import { loadSmartFileContent } from "@organizeup/agents";
import { withHousehold } from "@organizeup/db";
import { requireTenant } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireTenant();
  const { id } = await params;
  const file = await withHousehold(ctx, (tx) => loadSmartFileContent(tx, id));
  if (!file) return new Response(null, { status: 404 });
  return new Response(Buffer.from(file.content), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
