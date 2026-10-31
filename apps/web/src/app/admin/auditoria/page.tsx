import type { Metadata } from "next";
import { Card, FormMessage } from "@/components/ui";
import { requireAdmin } from "@/lib/session";
import { AdminPage } from "../kit";
import { ADMIN_DB_MISSING, hasAdminDatabase, noteAdminAccess } from "../painel";
import { AuditBoard } from "./audit-board";
import { DEFAULT_AUDIT, loadAudit } from "./data";

export const metadata: Metadata = { title: "Auditoria" };

export default async function AdminAuditPage() {
  const session = await requireAdmin();
  await noteAdminAccess(session.user.id, "auditoria:ver");

  return (
    <AdminPage
      title="Auditoria"
      description="Tudo o que foi feito e visto neste painel. O texto das buscas nunca é guardado."
    >
      {hasAdminDatabase() ? (
        <AuditBoard initial={await loadAudit(DEFAULT_AUDIT, 0, session.user.id)} />
      ) : (
        <Card>
          <FormMessage message={ADMIN_DB_MISSING} />
        </Card>
      )}
    </AdminPage>
  );
}
