import { adminBillingFamily, adminOwnedFamilies, adminUserDetail } from "@organizeup/db";
import { willChargeAgain } from "@organizeup/domain";
import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, FormMessage } from "@/components/ui";
import { requireAdmin } from "@/lib/session";
import { shortId } from "../../format";
import { AdminPage } from "../../kit";
import { ADMIN_DB_MISSING, hasAdminDatabase, noteAdminAccess } from "../../painel";
import { VipForm } from "./vip-form";

export const metadata: Metadata = { title: "Marcar como VIP" };

const back = (
  <Link href="/admin/vip" className="underline underline-offset-2">
    Voltar para VIP
  </Link>
);

export default async function AdminNewVipPage({
  searchParams,
}: {
  searchParams: Promise<{ familia?: string; conta?: string; alvo?: string }>;
}) {
  const session = await requireAdmin();
  await noteAdminAccess(session.user.id, "vip:novo");
  if (!hasAdminDatabase()) {
    return (
      <AdminPage title="Marcar como VIP">
        <Card>
          <FormMessage message={ADMIN_DB_MISSING} />
        </Card>
      </AdminPage>
    );
  }

  const { familia, conta, alvo } = await searchParams;
  const id = (familia ?? alvo ?? "").trim();
  const family = id ? await adminBillingFamily(id) : null;
  const userId = (conta ?? (family ? "" : (alvo ?? ""))).trim();
  const account = userId ? await adminUserDetail(userId) : null;
  const owned = account ? await adminOwnedFamilies(account.id) : [];

  if (family) {
    const charged = family.subscription !== null && willChargeAgain(family.subscription);
    return (
      <AdminPage title="Marcar como VIP" description={back}>
        <Card title={family.name} description="VIP de família: vale para todos os membros dela.">
          <VipForm
            scope="familia"
            families={[{ id: family.householdId, name: family.name }]}
            userId=""
            charged={charged}
          />
        </Card>
      </AdminPage>
    );
  }

  if (account && owned.length > 0) {
    return (
      <AdminPage title="Marcar como VIP" description={back}>
        <Card
          title={`Conta ${shortId(account.id)}`}
          description="VIP de pessoa vale para todos os membros de UMA família de que ela é responsável, enquanto ela for responsável por ela."
        >
          <VipForm scope="pessoa" families={owned} userId={account.id} charged={false} />
        </Card>
      </AdminPage>
    );
  }

  return (
    <AdminPage title="Marcar como VIP" description={back}>
      <Card>
        {account ? (
          <EmptyState
            title="Esta pessoa não é responsável por nenhuma família"
            text="VIP de pessoa só vale na família de que ela é responsável. Quem é só membro não passa VIP para a família. Marque a família, se for o caso."
          />
        ) : (
          <EmptyState
            title="Não encontramos este id"
            text="Abra a família ou a conta no painel e use Marcar como VIP."
          />
        )}
      </Card>
    </AdminPage>
  );
}
