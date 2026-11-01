"use client";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { Button, Card, ConfirmSheet, EmptyState, PageHeader } from "@/components/ui";
import { DEFAULT_LOCALE } from "@/i18n/locales";
import type { loadSuggestions, PendingItem, SuggestionBulk } from "@/lib/suggestions";
import { applyAll, undoSuggestion } from "./actions";
import {
  DecisionButtons,
  SuggestionFeedback,
  useSuggestionActions,
  type SuggestionActions,
} from "./suggestion-controls";

type Data = Awaited<ReturnType<typeof loadSuggestions>>;

function PendingCard({
  item,
  writable,
  actions,
}: {
  item: PendingItem;
  writable: boolean;
  actions: SuggestionActions;
}) {
  const t = useTranslations("sugestoes.pending");
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <p lang={DEFAULT_LOCALE} className="text-sm font-medium">
        {item.title}
      </p>
      <p lang={DEFAULT_LOCALE} className="mt-1 text-sm text-muted">
        {item.body}
      </p>
      {item.href ? (
        <Link
          href={item.href}
          aria-label={t("openItem", { name: item.title })}
          className="mt-1 inline-block text-sm font-medium underline underline-offset-2"
        >
          {t("open")}
        </Link>
      ) : null}
      {writable ? (
        <DecisionButtons
          id={item.id}
          title={item.title}
          actions={actions}
          {...(item.kind === "viagem" ? { acceptLabel: t("addTrip") } : {})}
        />
      ) : null}
    </li>
  );
}

export function SuggestionsBoard({ data, writable }: { data: Data; writable: boolean }) {
  const t = useTranslations("sugestoes");
  const actions = useSuggestionActions();
  const [bulk, setBulk] = useState<SuggestionBulk | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      <SuggestionFeedback result={actions.result} />

      <Card title={t("pending.title")}>
        {data.groups.length === 0 ? (
          <EmptyState title={t("pending.emptyTitle")} text={t("pending.emptyText")} />
        ) : (
          <div className="flex flex-col gap-6">
            {data.groups.map((group) => {
              const title = t(`groups.${group.key}`);
              return (
                <section key={group.key} aria-label={title}>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">{title}</h3>
                    {writable && group.bulk ? (
                      <Button
                        variant="secondary"
                        small
                        aria-label={t("pending.applyAllIn", { name: title })}
                        onClick={() => setBulk(group.bulk)}
                      >
                        {t("pending.applyAll")}
                      </Button>
                    ) : null}
                  </div>
                  <ul aria-label={title} className="m-0 list-none divide-y divide-line p-0">
                    {group.items.map((item) => (
                      <PendingCard
                        key={item.id}
                        item={item}
                        writable={writable}
                        actions={actions}
                      />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </Card>

      <Card title={t("automatic.title")} description={t("automatic.period")}>
        {data.automatic.length === 0 ? (
          <p className="text-sm text-muted">{t("automatic.empty")}</p>
        ) : (
          <ul aria-label={t("automatic.title")} className="m-0 list-none divide-y divide-line p-0">
            {data.automatic.map((item) => (
              <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                <p lang={DEFAULT_LOCALE} className="text-sm font-medium">
                  {item.title}
                </p>
                <p lang={DEFAULT_LOCALE} className="mt-1 text-sm text-muted">
                  {item.body}
                </p>
                {writable ? (
                  <Button
                    variant="secondary"
                    small
                    className="mt-3"
                    disabled={actions.busy !== null}
                    aria-label={t("automatic.undoItem", { name: item.title })}
                    onClick={() => actions.run(undoSuggestion, item.id)}
                  >
                    {t("automatic.undo")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ConfirmSheet
        open={bulk !== null}
        onClose={() => setBulk(null)}
        title={t("pending.applyAll")}
        text={bulk ? t(`bulk.${bulk.kind}`, { count: bulk.count }) : ""}
        confirmLabel={t("pending.applyAll")}
        action={(form) => actions.settle(applyAll, form)}
        hidden={{ kind: bulk?.kind ?? "" }}
      />
    </div>
  );
}
