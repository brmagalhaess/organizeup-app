"use client";
import { Lightbulb } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { buttonClass } from "@/components/styles";
import { Button } from "@/components/ui";
import type { InsightItem } from "@/lib/insights";
import { decideInsight } from "./actions";

/** Uma dica. Quem só pode ver lê e abre o "Por quê?", sem os botões. */
export function InsightCard({ insight, canAct }: { insight: InsightItem; canAct: boolean }) {
  const t = useTranslations("insights");
  const pathname = usePathname();
  const router = useRouter();
  const [pending, start] = useTransition();
  const here = pathname === insight.href;
  return (
    <li className="flex gap-3 rounded-xl border border-line bg-card-soft p-4">
      <Lightbulb className="mt-0.5 size-5 shrink-0 text-brand-700" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="min-w-0">
          <p className="m-0 text-sm font-semibold">{insight.title}</p>
          <p className="m-0 mt-1 break-words text-sm text-muted">{insight.body}</p>
        </div>
        <details className="text-sm">
          <summary className="w-fit cursor-pointer font-medium text-brand-700">{t("why")}</summary>
          <p className="m-0 mt-1 break-words text-muted">{insight.why}</p>
        </details>
        {canAct ? (
          <div className="flex flex-wrap items-center gap-2">
            {here ? null : (
              <Link
                href={insight.href}
                className={buttonClass("secondary", true)}
                onClick={() => void decideInsight(insight.id, "feita")}
              >
                {t("doNow")}
              </Link>
            )}
            <Button
              type="button"
              variant="ghost"
              small
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await decideInsight(insight.id, here ? "feita" : "dispensada");
                  router.refresh();
                })
              }
            >
              {here ? t("done") : t("gotIt")}
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}
