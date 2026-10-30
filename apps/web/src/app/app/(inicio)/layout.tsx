import Link from "next/link";

/** Telas antes de existir uma família ativa: criar ou escolher. */
export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-6 px-4 py-10">
      <Link href="/" className="font-display text-xl font-semibold">
        OrganizeUp
      </Link>
      {children}
    </main>
  );
}
