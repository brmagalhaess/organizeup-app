// Módulo desligado: a tela vira convite, com o que ele faz e o preço. Os dados ficam guardados.
import "server-only";
import { readBillingCatalog, readFamilyAccess } from "@organizeup/db";
import { canView, formatMoney, type BillingModule, type CatalogPrice } from "@organizeup/domain";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/styles";
import { Card, PageHeader } from "@/components/ui";
import { requireTenant } from "@/lib/session";

/** Item mais barato que libera o módulo: o assistente é vendido por degrau. */
const itemOf = (module: BillingModule) =>
  module === "assistente" ? "assistente:30" : `modulo:${module}`;

/** Para a primeira linha de cada tela de módulo: devolve o convite no lugar da tela, ou null. */
export async function moduleInvite(module: BillingModule): Promise<ReactNode | null> {
  const { ctx } = await requireTenant();
  if (canView(await readFamilyAccess(ctx), module)) return null;
  return <ModuleInvite module={module} catalog={await readBillingCatalog()} />;
}

async function ModuleInvite({
  module,
  catalog,
}: {
  module: BillingModule;
  catalog: CatalogPrice[];
}) {
  const [t, locale] = await Promise.all([getTranslations("assinatura"), getLocale()]);
  const price = catalog.find((row) => row.item === itemOf(module) && row.cycle === "mes");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={t("invite.eyebrow")} title={t(`modules.${module}.name`)} />
      <Card title={t("invite.title")} description={t(`modules.${module}.text`)}>
        <div className="flex flex-col gap-4">
          {price ? (
            <p className="m-0 text-lg font-semibold">
              {t("invite.price", { amount: formatMoney(price.amount, "BRL", locale) })}
            </p>
          ) : null}
          <p className="m-0 text-sm text-muted">{t("invite.kept")}</p>
          <div>
            <Link href="/app/assinatura" className={buttonClass("primary")}>
              {t("invite.link")}
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
