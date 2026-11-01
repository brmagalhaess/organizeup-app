import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { canWrite } from "@organizeup/db";
import { requireTenant } from "@/lib/session";
import { loadNetWorth } from "@/lib/wealth";
import { NetWorthBoard } from "./net-worth-board";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("patrimonio");
  return { title: t("metaTitle") };
}

export default async function NetWorthPage() {
  const { ctx } = await requireTenant();
  const data = await loadNetWorth(ctx, { record: true });
  return <NetWorthBoard data={data} writable={canWrite(ctx)} />;
}
