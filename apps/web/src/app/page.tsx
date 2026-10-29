import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 py-6 sm:px-6">
      <header className="flex items-center justify-between">
        <span className="text-lg font-bold text-brand-900 dark:text-brand-100">OrganizeUp</span>
        <nav className="flex items-center gap-2 text-sm">
          <Link href="/entrar" className="rounded-lg px-3 py-2 hover:bg-brand-50">
            Entrar
          </Link>
          <Link
            href="/cadastro"
            className="rounded-lg bg-brand-900 px-3 py-2 font-semibold text-white hover:bg-brand-700"
          >
            Criar conta
          </Link>
        </nav>
      </header>

      <section className="flex flex-1 flex-col justify-center gap-6 py-16">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-500">
          Finanças · Família · Sonhos · Aposentadoria
        </p>
        <h1 className="max-w-3xl text-4xl font-bold leading-tight sm:text-5xl">
          Organize o hoje. Dê espaço ao que vem depois.
        </h1>
        <p className="max-w-2xl text-lg text-muted">
          Receitas, despesas, dívidas, investimentos, viagens e aposentadoria conectados num plano
          da família — com um assistente que entende o seu contexto e explica cada mudança.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/cadastro"
            className="rounded-lg bg-brand-900 px-5 py-3 font-semibold text-white hover:bg-brand-700"
          >
            Começar meu plano
          </Link>
          <Link href="/entrar" className="rounded-lg border border-line px-5 py-3 font-semibold">
            Já tenho conta
          </Link>
        </div>
        <p className="text-xs text-muted">
          Seus dados ficam isolados no espaço da sua família. Análises explicam o plano;
          movimentações dependem da sua confirmação.
        </p>
      </section>
    </main>
  );
}
