"use client";
// Situação da assinatura: cancelar em um clique, devolução nos 7 dias, cartão e faturas.
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button, Card, ConfirmSheet, FormMessage } from "@/components/ui";
import {
  cancelPlan,
  openPortal,
  refundPlan,
  resumePlan,
  type PlanFailure,
  type PlanReply,
} from "./actions";

const failed = { ok: false, code: "falhou" } as const;

export function SubscriptionPanel({
  canBuy,
  active,
  cancelling,
  refundable,
}: {
  canBuy: boolean;
  /** Falso: já acabou, e sobrou só concluir a devolução. */
  active: boolean;
  /** Já cancelou: vale até o fim do período. */
  cancelling: boolean;
  refundable: boolean;
}) {
  const t = useTranslations("assinatura");
  const [asking, setAsking] = useState<"cancel" | "refund" | null>(null);
  const [failure, setFailure] = useState<PlanFailure | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const run = async (action: () => Promise<PlanReply>, message: string) => {
    setFailure(null);
    const reply = await action().catch(() => failed);
    if (reply.ok) setDone(message);
    else setFailure(reply.code);
  };
  const refund = async () => {
    setFailure(null);
    const reply = await refundPlan().catch(() => failed);
    if (!reply.ok) setFailure(reply.code);
    else setDone(t(reply.outcome === "boleto" ? "refund.boleto" : "refund.done"));
  };
  const portal = () =>
    startTransition(async () => {
      const reply = await openPortal().catch(() => failed);
      if (reply.ok) window.location.assign(reply.url);
      else setFailure(reply.code);
    });

  if (!canBuy) return null;
  return (
    <Card title={t("manage.title")} description={t("manage.text")}>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy} onClick={portal}>
          {t("manage.portal")}
        </Button>
        {!active ? null : cancelling ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => startTransition(() => run(resumePlan, t("manage.resumed")))}
          >
            {t("manage.resume")}
          </Button>
        ) : (
          <Button variant="secondary" disabled={busy} onClick={() => setAsking("cancel")}>
            {t("manage.cancel")}
          </Button>
        )}
        {refundable ? (
          <Button variant="secondary" disabled={busy} onClick={() => setAsking("refund")}>
            {t("refund.ask")}
          </Button>
        ) : null}
      </div>
      {done ? <FormMessage message={done} tone="ok" /> : null}
      {failure ? <FormMessage message={t(`failure.${failure}`)} /> : null}
      <ConfirmSheet
        open={asking === "cancel"}
        onClose={() => setAsking(null)}
        title={t("manage.cancelTitle")}
        text={t("manage.cancelText")}
        confirmLabel={t("manage.cancelConfirm")}
        action={() => run(cancelPlan, t("manage.cancelled"))}
        hidden={{}}
      />
      <ConfirmSheet
        open={asking === "refund"}
        onClose={() => setAsking(null)}
        title={t("refund.title")}
        text={t("refund.text")}
        confirmLabel={t("refund.confirm")}
        action={refund}
        hidden={{}}
      />
    </Card>
  );
}
