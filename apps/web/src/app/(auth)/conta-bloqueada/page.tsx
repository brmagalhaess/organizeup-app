import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.blocked");
  return { title: t("metaTitle") };
}

export default async function BlockedAccountPage() {
  const t = await getTranslations("auth.blocked");
  return (
    <div>
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="mt-2 text-sm text-muted">{t("text")}</p>
    </div>
  );
}
