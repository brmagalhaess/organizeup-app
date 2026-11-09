import { Check } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { LocaleSelect } from "@/components/locale-select";

/**
 * Entrar, criar conta, esqueci e redefinir senha: a marca de um lado, o formulário em um cartão do outro.
 * No celular fica uma coluna só, com o cartão primeiro. Cores e fontes vêm dos tokens de `globals.css`.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("auth.layout");
  const points = ["one", "two", "three"] as const;
  return (
    <main className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <section
        aria-label={t("eyebrow")}
        className="relative hidden overflow-hidden bg-pine px-12 py-12 text-sand-50 lg:flex lg:flex-col"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 -bottom-40 size-[28rem] rounded-full border border-white/15 shadow-[inset_0_0_0_60px_rgb(255_255_255_/_4%)]"
        />
        <Link href="/" className="font-display text-2xl font-semibold text-white">
          {t("eyebrow")}
        </Link>
        <div className="my-auto max-w-xl py-12">
          <h1 className="font-display text-5xl leading-[1.08] font-medium tracking-tight text-white">
            {t("headline")}
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-sand-100/90">{t("lead")}</p>
          <ul className="m-0 mt-10 flex list-none flex-col gap-4 p-0">
            {points.map((point) => (
              <li key={point} className="flex items-start gap-3 text-base text-sand-50">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-peach text-night">
                  <Check className="size-3.5" aria-hidden="true" />
                </span>
                {t(`points.${point}`)}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm tracking-wide text-sand-100/70">{t("footer")}</p>
      </section>

      <section className="flex min-h-dvh flex-col bg-surface px-4 py-8 sm:px-8 lg:min-h-0 lg:justify-center lg:py-12">
        <div className="mx-auto flex w-full max-w-md flex-col gap-6">
          <Link
            href="/"
            className="self-start font-display text-xl font-semibold text-brand-900 lg:hidden"
          >
            {t("eyebrow")}
          </Link>
          <div className="flex flex-col gap-6 rounded-3xl border border-line bg-card p-6 shadow-card sm:p-8">
            {children}
          </div>
          <div className="max-w-56 self-center">
            <LocaleSelect />
          </div>
        </div>
      </section>
    </main>
  );
}
