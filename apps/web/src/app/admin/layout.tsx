import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/styles";
import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "./admin-nav";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // O portão fica aqui, acima do loading.tsx: é o que garante o status 404 e nenhum pedaço do
  // painel para quem não é administrador. As páginas repetem a checagem para a navegação interna.
  await requireAdmin();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-4">
        <PageHeader
          title="Painel do serviço"
          actions={
            <Link href="/app" className={buttonClass("secondary", true)}>
              Voltar ao app
            </Link>
          }
        />
        <AdminNav />
      </header>
      <main className="flex flex-col gap-6">{children}</main>
    </div>
  );
}
