import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <Link href="/" className="text-lg font-bold text-brand-900 dark:text-brand-100">
        OrganizeUp
      </Link>
      {children}
    </main>
  );
}
