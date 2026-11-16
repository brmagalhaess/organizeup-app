// Avisos da família no app: a mesma lista da tela de notificações.
import { markAllRead } from "@/app/app/(painel)/notificacoes/actions";
import { loadNotifications } from "@/lib/notifications";
import { mobileError, mobileJson, mobileTenant } from "@/lib/mobile-api";
import { sameSite } from "@/lib/same-site";

export const dynamic = "force-dynamic";

/** O app mostra as mais novas; o histórico completo fica na web. */
const MAX_ITEMS = 50;

export async function GET() {
  const tenant = await mobileTenant();
  if (tenant instanceof Response) return tenant;
  const items = (await loadNotifications(tenant.ctx, "todas")) ?? [];
  return mobileJson({
    items: items.slice(0, MAX_ITEMS).map((item) => ({
      id: item.id,
      title: item.title,
      body: item.body,
      createdAt: item.createdAt.toISOString(),
      read: item.read,
    })),
  });
}

/** Marca tudo como lido, para a família inteira, como o botão da tela. */
export async function POST(request: Request) {
  if (!sameSite(request)) return mobileError("forbidden", 403);
  const tenant = await mobileTenant();
  if (tenant instanceof Response) return tenant;
  const result = await markAllRead();
  return result.ok ? mobileJson({ ok: true }) : mobileError("forbidden", 403, result.message);
}
