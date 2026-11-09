import { useTranslations } from "next-intl";

/** Entre o login e o painel: a marca, uma barra em movimento e o que está sendo carregado. */
export default function Loading() {
  const t = useTranslations("familiaOnboarding.loading");
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl border border-line bg-card p-8 text-center shadow-card"
    >
      <span className="font-display text-2xl font-semibold text-brand-900">OrganizeUp</span>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-line" aria-hidden="true">
        <div className="h-full w-2/5 animate-[carregando_1.3s_ease-in-out_infinite] rounded-full bg-brand-500 motion-reduce:w-full motion-reduce:animate-none" />
      </div>
      <p className="m-0 text-base font-semibold">{t("title")}</p>
      <p className="m-0 text-sm text-muted">{t("text")}</p>
    </div>
  );
}
