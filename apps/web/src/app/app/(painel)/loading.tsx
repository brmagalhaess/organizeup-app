import { useTranslations } from "next-intl";

export default function Loading() {
  const t = useTranslations("common");
  return (
    <div role="status" aria-label={t("loading")} className="flex animate-pulse flex-col gap-6">
      <div className="h-10 w-64 rounded-xl bg-line" />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-28 rounded-2xl bg-line" />
        ))}
      </div>
      <div className="h-80 rounded-2xl bg-line" />
    </div>
  );
}
