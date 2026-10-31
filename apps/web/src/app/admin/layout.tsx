import type { Metadata } from "next";
import Link from "next/link";
import { platformFlags, requireAdmin } from "@/lib/session";
import { AdminShell } from "./admin-shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // O portão fica aqui, acima do loading.tsx: é o que garante o status 404 e nenhum pedaço do
  // painel para quem não é administrador. As páginas repetem a checagem para a navegação interna.
  const session = await requireAdmin();
  const { maintenance } = await platformFlags();
  return (
    <AdminShell
      userName={session.user.name}
      banner={
        maintenance ? (
          <section
            role="region"
            aria-label="Aviso do serviço"
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-warning-soft px-4 py-2 text-sm sm:px-6 lg:px-10 2xl:px-14"
          >
            <p>Modo manutenção ligado: as famílias estão só leitura.</p>
            <Link href="/admin/controles" className="font-semibold underline underline-offset-2">
              Ver controles
            </Link>
          </section>
        ) : null
      }
    >
      {children}
    </AdminShell>
  );
}
