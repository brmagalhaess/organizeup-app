import { canWrite, type InsightScreen } from "@organizeup/db";
import { getTranslations } from "next-intl/server";
import { loadInsights } from "@/lib/insights";
import { requireTenant } from "@/lib/session";
import { InsightCard } from "./insight-card";

/** Dicas da tela. Sem dica, não ocupa espaço: quem não autorizou o assistente vê a tela de sempre. */
export async function Insights({ screen }: { screen: InsightScreen }) {
  const { ctx } = await requireTenant();
  const items = await loadInsights(ctx, screen);
  if (items.length === 0) return null;
  const t = await getTranslations("insights");
  return (
    <section aria-label={t("region")}>
      <ul className="m-0 grid list-none gap-3 p-0 lg:grid-cols-2">
        {items.map((item) => (
          <InsightCard key={item.id} insight={item} canAct={canWrite(ctx)} />
        ))}
      </ul>
    </section>
  );
}
