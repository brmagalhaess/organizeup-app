import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { LocaleSelect } from "@/components/locale-select";
import { DEFAULT_LOCALE } from "@/i18n/locales";
import { LEGAL_UPDATED } from "@/lib/legal";

/** Os documentos ficam só em português até haver revisão jurídica (ADR-0020). */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations("legal");
  const locale = useLocale();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <Link href="/" className="text-lg font-bold text-brand-900 dark:text-brand-100">
        OrganizeUp
      </Link>
      {locale === DEFAULT_LOCALE ? null : (
        <p role="note" className="rounded-xl bg-brand-100 px-4 py-3 text-sm text-ink">
          {t("notice")}
        </p>
      )}
      <div lang={DEFAULT_LOCALE} className="flex flex-col gap-6">
        <article className="flex flex-col gap-4 text-sm leading-relaxed [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:pl-5">
          {children}
        </article>
        <p className="text-xs text-muted">Última atualização: {LEGAL_UPDATED}.</p>
        <nav aria-label="Documentos" className="flex gap-4 text-sm">
          <Link href="/termos" className="font-semibold text-brand-700 underline">
            Termos de Uso
          </Link>
          <Link href="/privacidade" className="font-semibold text-brand-700 underline">
            Política de Privacidade
          </Link>
        </nav>
      </div>
      <div className="max-w-56">
        <LocaleSelect />
      </div>
    </main>
  );
}
