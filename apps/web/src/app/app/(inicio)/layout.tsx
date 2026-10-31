import Link from "next/link";
import { platformFlags } from "@/lib/session";

/** Telas antes de existir uma família ativa: criar ou escolher. */
export default async function SetupLayout({ children }: { children: React.ReactNode }) {
  const { maintenance } = await platformFlags();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-6 px-4 py-10">
      <Link href="/" className="font-display text-xl font-semibold">
        OrganizeUp
      </Link>
      {maintenance ? (
        <p role="status" className="rounded-xl bg-brand-100 px-4 py-3 text-sm">
          Estamos em manutenção. Criar família e fazer alterações estão desligados por enquanto.
        </p>
      ) : null}
      {children}
    </main>
  );
}
