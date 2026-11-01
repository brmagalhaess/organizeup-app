import { captureEvent, describeClientError, normalizeRoute } from "@organizeup/db";
import { z } from "zod";
import { findPersonalData } from "@/lib/ops-content";
import { createRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const MAX_BODY = 1024;

const allowByIp = createRateLimiter({ limit: 20, windowMs: 60_000 });
/** O cabeçalho do IP pode ser forjado: este teto vale para todos juntos. */
const allowOverall = createRateLimiter({ limit: 300, windowMs: 60_000 });

const screenErrorSchema = z
  .object({
    fingerprint: z.string().regex(/^[0-9a-f]{32}$/),
    route: z
      .string()
      .max(300)
      .refine((route) => route.startsWith("/") && !findPersonalData(route)),
  })
  .strict();

const clientIp = (request: Request) =>
  request.headers.get("cf-connecting-ip") ??
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
  "desconhecido";

/**
 * POST /api/diagnostics → as telas de erro avisam do que só o navegador viu. Público, porque a tela
 * pode ter quebrado junto com a sessão; por isso só aceita impressão digital e rota, e a rota é
 * limpa de novo aqui. Nunca devolve detalhe: quem chama é uma tela que já falhou.
 */
export async function POST(request: Request) {
  if (!allowOverall("todos") || !allowByIp(clientIp(request))) {
    return new Response(null, { status: 429 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) {
    return new Response(null, { status: 413 });
  }
  const body = await request.text().catch(() => "");
  if (body.length > MAX_BODY) return new Response(null, { status: 413 });
  let raw: unknown = null;
  try {
    raw = JSON.parse(body);
  } catch {
    return new Response(null, { status: 422 });
  }
  const parsed = screenErrorSchema.safeParse(raw);
  if (!parsed.success) return new Response(null, { status: 422 });
  await captureEvent(
    describeClientError(parsed.data.fingerprint, normalizeRoute(parsed.data.route)),
  );
  return new Response(null, { status: 204 });
}
