// Recebe um arquivo de dívida. Passa por rota, e não por server action, porque o limite das actions é
// de 3 MB. O tipo e o tamanho valem pelo conteúdo, conferidos aqui, nunca pelo que o navegador disse.
import { saveDebtDocument } from "@organizeup/agents";
import { canWrite, withHousehold } from "@organizeup/db";
import { checkDebtFile, DEBT_FILE_MAX_BYTES } from "@organizeup/domain";
import { getTranslations } from "next-intl/server";
import { createRateLimiter } from "@/lib/rate-limit";
import { sameSite } from "@/lib/same-site";
import { requireModule } from "@/lib/billing/plan-gate";

/** Código devolvido por domínio e agentes → texto em `dividas.upload`. */
const FILE_TEXT = { vazio: "empty", tamanho: "tooLarge", tipo: "wrongType" } as const;
const SAVE_TEXT = { somente_leitura: "readOnly", cota: "quota", divida: "noDebt" } as const;

export const dynamic = "force-dynamic";

const allow = createRateLimiter({ limit: 30, windowMs: 60_000 });
/** Folga para o envelope do formulário em volta do arquivo. */
const FORM_OVERHEAD = 64 * 1024;

const refuse = (message: string, status: number) =>
  Response.json({ ok: false, message }, { status });

export async function POST(request: Request) {
  if (!sameSite(request)) return new Response(null, { status: 403 });
  const { ctx } = await requireModule("dividas");
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

  const bytes = new Uint8Array(await file.arrayBuffer());
  const checked = checkDebtFile(bytes, file.name);
  if (!checked.ok) {
    return refuse(t(FILE_TEXT[checked.code]), checked.code === "tamanho" ? 413 : 415);
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
  if (!saved.ok) return refuse(t(SAVE_TEXT[saved.code]), saved.code === "cota" ? 413 : 400);
  return Response.json(saved);
}
