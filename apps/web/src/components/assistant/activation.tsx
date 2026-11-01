"use client";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useActionState } from "react";
import { Button, FormMessage } from "@/components/ui";
import { activate, type AssistantActionState } from "./actions";
import { AUTONOMY_LEVELS } from "./copy";

const initial: AssistantActionState = { ok: false, message: null };

function Topic({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="m-0 text-sm font-semibold">{title}</h3>
      <div className="mt-1 text-sm text-muted">{children}</div>
    </section>
  );
}

/** Primeiro uso. Sem este aceite, o servidor não chama o modelo. */
export function Activation({ headingId }: { headingId: string }) {
  const t = useTranslations("assistente.activation");
  const tLevels = useTranslations("settings.assistant.levels");
  const [state, action, pending] = useActionState(activate, initial);
  return (
    <form action={action} className="flex flex-col gap-5">
      <div>
        <h2 id={headingId} className="m-0 font-display text-xl font-medium">
          {t("title")}
        </h2>
        <p className="mt-1 text-sm text-muted">{t("text")}</p>
      </div>
      <Topic title={t("usesTitle")}>{t("uses")}</Topic>
      <Topic title={t("leavesOutTitle")}>{t("leavesOut")}</Topic>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-sm font-semibold">{t("levelLegend")}</legend>
        {AUTONOMY_LEVELS.map((level) => (
          <label
            key={level}
            className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-card-soft p-3 text-sm"
          >
            <input
              type="radio"
              name="autonomy"
              value={level}
              defaultChecked={level === "organizar"}
              className="mt-0.5 size-4 accent-brand-700"
            />
            <span className="min-w-0">
              <span className="block font-medium">{tLevels(level)}</span>
              <span className="block text-muted">{tLevels(`${level}Text`)}</span>
            </span>
          </label>
        ))}
        <p className="m-0 text-xs text-muted">{t("levelHint")}</p>
      </fieldset>

      <label className="flex cursor-pointer items-start gap-3 text-sm">
        <input type="checkbox" name="consent" required className="mt-0.5 size-4 accent-brand-700" />
        <span>
          {t.rich("consent", {
            privacy: (chunks) => (
              <Link
                href="/privacidade"
                target="_blank"
                className="font-semibold text-brand-700 underline"
              >
                {chunks}
              </Link>
            ),
          })}
        </span>
      </label>
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? t("pending") : t("submit")}
      </Button>
    </form>
  );
}
