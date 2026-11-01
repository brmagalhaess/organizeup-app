import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { CreateHouseholdForm } from "./create-household-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("familiaOnboarding.create");
  return { title: t("metaTitle") };
}

export default function NewHouseholdPage() {
  const t = useTranslations("familiaOnboarding.create");
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted">{t("text")}</p>
      </div>
      <CreateHouseholdForm />
    </div>
  );
}
