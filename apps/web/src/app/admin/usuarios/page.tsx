import type { Metadata } from "next";
import { Card, FormMessage } from "@/components/ui";
import { requireAdmin } from "@/lib/session";
import { AdminPage } from "../kit";
import { ADMIN_DB_MISSING, hasAdminDatabase, noteAdminAccess } from "../painel";
import { loadUsers } from "./data";
import { UsersBoard } from "./users-board";

export const metadata: Metadata = { title: "Usuários" };

export default async function AdminUsersPage() {
  const session = await requireAdmin();
  await noteAdminAccess(session.user.id, "usuarios:lista");

  return (
    <AdminPage
      title="Usuários"
      description="As contas aparecem por um código. Nome e e-mail só por ação registrada."
    >
      {hasAdminDatabase() ? (
        <UsersBoard initial={await loadUsers("", 0, "todos")} />
      ) : (
        <Card>
          <FormMessage message={ADMIN_DB_MISSING} />
        </Card>
      )}
    </AdminPage>
  );
}
