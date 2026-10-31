import type { Metadata } from "next";
import { Card, FormMessage } from "@/components/ui";
import { requireAdmin } from "@/lib/session";
import { ADMIN_DB_MISSING, hasAdminDatabase, noteAdminAccess } from "../painel";
import { loadFamilies } from "./data";
import { FamiliesBoard } from "./families-board";

export const metadata: Metadata = { title: "Famílias" };

export default async function AdminFamiliesPage() {
  const session = await requireAdmin();
  await noteAdminAccess(session.user.id, "familias:lista");

  return (
    <>
      {hasAdminDatabase() ? (
        <FamiliesBoard initial={await loadFamilies("", 0)} />
      ) : (
        <Card title="Famílias">
          <FormMessage message={ADMIN_DB_MISSING} />
        </Card>
      )}
      <p className="text-xs text-muted">
        Dados pessoais mínimos para suporte; cada acesso é registrado.
      </p>
    </>
  );
}
