import { useTranslations } from "next-intl";

export default function Loading() {
  const t = useTranslations("common");
  return (
    <div role="status" aria-label={t("loading")} className="flex animate-pulse flex-col gap-6">
      <div className="h-10 w-64 max-w-full rounded-xl bg-line" />
      <div className="h-11 w-full max-w-md rounded-xl bg-line" />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-28 rounded-2xl bg-line" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="h-80 rounded-2xl bg-line" />
        <div className="hidden h-80 rounded-2xl bg-line xl:block" />
      </div>
      <div className="h-64 rounded-2xl bg-line" />
    </div>
  );
}
