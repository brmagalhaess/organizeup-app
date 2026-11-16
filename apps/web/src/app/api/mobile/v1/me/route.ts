// Quem está no app: a pessoa, a família aberta e as famílias de que participa.
import {
  canWrite,
  ensureFinanceDefaults,
  fromSession,
  householdCurrency,
  listMemberships,
  readFamilyAccess,
  suspendedHouseholdIds,
  withHousehold,
} from "@organizeup/db";
import { getLocale } from "next-intl/server";
import { mobileJson, mobileSession } from "@/lib/mobile-api";
import { platformFlags } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await mobileSession();
  if (session instanceof Response) return session;
  const [memberships, ctx, locale, flags] = await Promise.all([
    listMemberships(session.user.id),
    fromSession(session),
    getLocale(),
    platformFlags(),
  ]);
  const suspended = await suspendedHouseholdIds(memberships.map((item) => item.householdId));
  const active = ctx ? memberships.find((item) => item.householdId === ctx.householdId) : undefined;
  const usable = ctx && active && !suspended.has(ctx.householdId) ? ctx : null;
  // Como o layout do painel: família nova ganha contas e categorias padrão na primeira abertura. Com a
  // manutenção ligada ou o plano vencido a RLS recusaria, então só tenta quem pode escrever de verdade.
  const currency = usable
    ? await withHousehold(usable, async (tx) => {
        const access = await readFamilyAccess(usable, flags);
        if (canWrite(usable) && !flags.maintenance && access.mode !== "leitura") {
          await ensureFinanceDefaults(tx, usable.householdId);
        }
        return householdCurrency(tx);
      })
    : null;
  return mobileJson({
    user: { name: session.user.name, email: session.user.email },
    locale,
    family: usable
      ? {
          id: usable.householdId,
          name: active!.name,
          role: usable.role,
          canWrite: canWrite(usable),
          currency,
        }
      : null,
    families: memberships.map((item) => ({
      id: item.householdId,
      name: item.name,
      role: item.role,
      suspended: suspended.has(item.householdId),
    })),
  });
}
