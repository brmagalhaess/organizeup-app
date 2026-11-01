// Recebe um arquivo de dívida. Passa por rota, e não por server action, porque o limite das actions é
// de 3 MB. O tipo e o tamanho valem pelo conteúdo, conferidos aqui, nunca pelo que o navegador disse.
import { saveDebtDocument } from "@organizeup/agents";
import { canWrite, withHousehold } from "@organizeup/db";
import { checkDebtFile, DEBT_FILE_MAX_BYTES } from "@organizeup/domain";
import { getMessages, getTranslations } from "next-intl/server";
import { knownText } from "@/i18n/known-text";
import { createRateLimiter } from "@/lib/rate-limit";
import { sameSite } from "@/lib/same-site";
import { requireTenant } from "@/lib/session";
import ptBR from "../../../../../messages/pt-BR.json";

export const dynamic = "force-dynamic";

const allow = createRateLimiter({ limit: 30, windowMs: 60_000 });
/** Folga para o envelope do formulário em volta do arquivo. */
const FORM_OVERHEAD = 64 * 1024;

const refuse = (message: string, status: number) =>
  Response.json({ ok: false, message }, { status });

export async function POST(request: Request) {
  if (!sameSite(request)) return new Response(null, { status: 403 });
  const { ctx } = await requireTenant();
  const t = await getTranslations("dividas.upload");
  if (!canWrite(ctx)) return refuse(t("readOnly"), 403);
  if (!allow(ctx.householdId)) return refuse(t("tooMany"), 429);

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > DEBT_FILE_MAX_BYTES + FORM_OVERHEAD) {
    return refuse(t("tooLarge"), 413);
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return refuse(t("noFile"), 400);

  const { upload } = (await getMessages()).dividas;
  const inLocale = (text: string) => knownText(text, ptBR.dividas.upload, upload);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const checked = checkDebtFile(bytes, file.name);
  if (!checked.ok) {
    return refuse(inLocale(checked.message), checked.code === "tamanho" ? 413 : 415);
  }

  const debtId = form?.get("debtId");
  const saved = await withHousehold(ctx, (tx) =>
    saveDebtDocument(tx, ctx, {
      fileName: checked.fileName,
      mediaType: checked.mediaType,
      bytes,
      debtId: typeof debtId === "string" && debtId ? debtId : null,
    }),
  );
  if (!saved.ok) return refuse(inLocale(saved.message), saved.code === "cota" ? 413 : 400);
  return Response.json(saved);
}
