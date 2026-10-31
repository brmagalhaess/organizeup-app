import type { Metadata } from "next";
import { Card, FormMessage } from "@/components/ui";
import { requireAdmin } from "@/lib/session";
import { AdminPage } from "../kit";
import { ADMIN_DB_MISSING, hasAdminDatabase, noteAdminAccess } from "../painel";
import { loadFamilies, NO_FAMILY_FILTERS } from "./data";
import { FamiliesBoard } from "./families-board";

export const metadata: Metadata = { title: "Famílias" };

export default async function AdminFamiliesPage() {
  const session = await requireAdmin();
  await noteAdminAccess(session.user.id, "familias:lista");

  return (
    <AdminPage
      title="Famílias"
      description="Dados pessoais mínimos para suporte; cada acesso é registrado."
    >
      {hasAdminDatabase() ? (
        <FamiliesBoard initial={await loadFamilies("", 0, NO_FAMILY_FILTERS)} />
      ) : (
        <Card>
          <FormMessage message={ADMIN_DB_MISSING} />
        </Card>
      )}
    </AdminPage>
  );
}
