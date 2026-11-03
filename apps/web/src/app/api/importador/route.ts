// Recebe um arquivo do importador (ADR-0030), um por pedido, para a tela mostrar o resultado de cada um. Rota, e
// não server action, porque o limite das actions é de 3 MB. Tipo e tamanho valem pelo conteúdo, conferidos
// aqui. Sem `importId`, abre o lote. Módulo: Base, porque o que pesa é a aprovação, item a item.
import { createSmartImport, saveSmartFile } from "@organizeup/agents";
import { canWrite, tolerateSchemaLag, withHousehold } from "@organizeup/db";
import { checkSmartFile, SMART_FILE_MAX_BYTES } from "@organizeup/domain";
import { getTranslations } from "next-intl/server";
import { createRateLimiter } from "@/lib/rate-limit";
import { sameSite } from "@/lib/same-site";
import { requireSmartImport } from "@/lib/importador/access";
import { platformFlags } from "@/lib/session";

export const dynamic = "force-dynamic";

const allow = createRateLimiter({ limit: 40, windowMs: 60_000 });
/** Folga para o envelope do formulário em volta do arquivo. */
const FORM_OVERHEAD = 64 * 1024;
const MAX_BODY = SMART_FILE_MAX_BYTES + FORM_OVERHEAD;

/** Lê o corpo contando. Passou do limite, cancela: o resto nem chega à memória. */
async function readLimited(
  request: Request,
  limit: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

const refuse = (code: string, message: string, status: number) =>
  Response.json({ ok: false, code, message }, { status });

export async function POST(request: Request) {
  if (!sameSite(request)) return new Response(null, { status: 403 });
  const { ctx } = await requireSmartImport();
  const t = await getTranslations("importador.upload");
  if (!canWrite(ctx)) return refuse("somente_leitura", t("readOnly"), 403);
  if (!allow(ctx.householdId)) return refuse("muitos_pedidos", t("tooMany"), 429);

  // O formulário nunca é lido por inteiro antes da conta: quem mente no cabeçalho para no contador.
  const declared = Number(request.headers.get("content-length"));
  if (!request.headers.get("content-length") || !Number.isSafeInteger(declared) || declared < 0) {
    return refuse("sem_tamanho", t("noLength"), 411);
  }
  if (declared > MAX_BODY) return refuse("tamanho", t("tamanho"), 413);
  const body = await readLimited(request, MAX_BODY);
  if (!body) return refuse("tamanho", t("tamanho"), 413);
  const form = await new Response(body, {
    headers: { "content-type": request.headers.get("content-type") ?? "" },
  })
    .formData()
    .catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return refuse("sem_arquivo", t("noFile"), 400);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const checked = checkSmartFile(bytes, file.name);
  if (!checked.ok) {
    return refuse(checked.code, t(checked.code), checked.code === "tamanho" ? 413 : 415);
  }

  const given = form?.get("importId");
  const { smartImportEnabled } = await platformFlags();
  const saved = await tolerateSchemaLag(
    () =>
      withHousehold(ctx, async (tx) => {
        const importId =
          typeof given === "string" && given
            ? given
            : await createSmartImport(tx, ctx, !smartImportEnabled);
        if (!importId) return { ok: false as const, code: "somente_leitura" as const };
        const result = await saveSmartFile(tx, ctx, {
          importId,
          fileName: checked.fileName,
          mediaType: checked.mediaType,
          bytes,
        });
        return { ...result, importId };
      }),
    null,
  );
  if (!saved) return refuse("atualizando", t("updating"), 503);
  if (!saved.ok) {
    return Response.json(
      {
        ok: false,
        code: saved.code,
        message: t(saved.code),
        otherImportId: "otherImportId" in saved ? saved.otherImportId : undefined,
      },
      { status: saved.code === "somente_leitura" ? 403 : 413 },
    );
  }
  return Response.json(saved);
}
