import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { canWrite } from "@organizeup/db";
import { loadIncome } from "@/lib/income-data";
import { requireTenant } from "@/lib/session";
import { IncomeBoard } from "./income-board";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("renda");
  return { title: t("metaTitle") };
}

export default async function IncomePage() {
  const { ctx } = await requireTenant();
  const data = await loadIncome(ctx);
  return <IncomeBoard data={data} writable={canWrite(ctx)} />;
}
