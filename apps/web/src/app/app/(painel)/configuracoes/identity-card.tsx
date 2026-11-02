import { useTranslations } from "next-intl";
import Link from "next/link";
import { Card } from "@/components/ui";
import { buttonClass } from "@/components/styles";
import type { IdentityView } from "@/lib/identity";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="m-0 break-words font-medium">{value}</dd>
    </div>
  );
}

/** Documento da conta: sempre mascarado, só da própria pessoa. A razão social é dela e aparece inteira. */
export function IdentityCard({ view }: { view: IdentityView }) {
  const t = useTranslations("identity");
  const company = view.personType === "pj";
  const title = t(company ? "settings.companyTitle" : "settings.personTitle");
  const stored = t("settings.hidden");

  if (!view.personType) {
    return (
      <Card title={title} description={t("settings.description")}>
        <p className="m-0 text-sm">{t(view.abroad ? "settings.abroad" : "settings.missing")}</p>
        <Link
          href="/app/completar?passo=documento"
          className={`${buttonClass("secondary", true)} mt-3`}
        >
          {t("settings.add")}
        </Link>
      </Card>
    );
  }
  return (
    <Card title={title} description={t("settings.description")}>
      <dl className="m-0 grid gap-3 text-sm">
        <Row label={t("settings.type")} value={t(company ? "company" : "personal")} />
        {company ? (
          <>
            <Row label={t("companyName")} value={view.companyName ?? stored} />
            <Row label={t("cnpj")} value={view.cnpj ?? stored} />
          </>
        ) : null}
        <Row label={company ? t("settings.responsibleCpf") : t("cpf")} value={view.cpf ?? stored} />
      </dl>
      <p className="mt-3 text-xs text-muted">{t("settings.fix")}</p>
    </Card>
  );
}
