// Webhook da Stripe (ADR-0023): fora de sessão e de `proxy.ts`, quem prova é a assinatura. Guarda o
// evento uma vez por id e responde; o worker aplica na tabela da família. A família não tem o que fazer
// aqui, por isso nenhuma gravação usa o papel dela, e a web segue sem credencial de escrita no plano.
import { captureError, recordBillingEvent } from "@organizeup/db";
import { queueBillingEvents } from "@/app/admin/fila";
import { normalizeEvent, verifyEvent } from "@/lib/billing/events";
import { liveAllowed } from "@/lib/billing/stripe-key";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) return new Response(null, { status: 503 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response(null, { status: 400 });
  const payload = await request.text();

  let event;
  try {
    event = verifyEvent(payload, signature, secret);
  } catch {
    return new Response(null, { status: 400 });
  }
  // Produção sem a variável do fundador: não guarda. A Stripe repete por dias, então nada se perde.
  if (event.livemode && !liveAllowed()) return new Response(null, { status: 503 });

  const normalized = normalizeEvent(event);
  if (normalized) {
    try {
      const fresh = await recordBillingEvent(normalized);
      // Falhar aqui só atrasa até a passada do minuto seguinte.
      if (fresh) await queueBillingEvents().catch(() => undefined);
    } catch (error) {
      void captureError(error, {
        service: "web",
        source: "route",
        route: "/api/webhooks/stripe",
      });
      return new Response(null, { status: 500 });
    }
  }
  return Response.json({ received: true });
}
