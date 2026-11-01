"use client";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { updateWedding, type ActionState } from "@/app/app/actions";
import { Button, Card, FormMessage, submitKeeping } from "@/components/ui";
import { WeddingFields, type WeddingValues } from "./person-fields";

const initial: ActionState = { ok: false, message: null };

export function WeddingForm({ values, writable }: { values: WeddingValues; writable: boolean }) {
  const t = useTranslations("pessoas.wedding");
  const tCommon = useTranslations("common");
  const [state, action, pending] = useActionState(updateWedding, initial);
  return (
    <Card title={t("title")} description={t("description")}>
      <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
        <fieldset disabled={!writable} className="contents">
          <WeddingFields values={values} errors={state.fieldErrors} />
          {writable ? (
            <div>
              <Button type="submit" variant="secondary" small disabled={pending}>
                {pending ? tCommon("saving") : t("save")}
              </Button>
            </div>
          ) : null}
        </fieldset>
        <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      </form>
    </Card>
  );
}
