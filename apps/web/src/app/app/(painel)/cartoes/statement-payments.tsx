"use client";
import { Link2, Link2Off } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";
import { joinReplaces, money, statementCarry, toDbAmount, type JoinMode } from "@organizeup/domain";
import { Badge, Button, ConfirmSheet, Field, FormMessage, Select, Sheet } from "@/components/ui";
import { formatDayMonth } from "@/i18n/format";
import { useMoney } from "@/i18n/money";
import type { StatementDebit, StatementPayments } from "@/lib/card-statements";
import { joinStatementDebit, splitStatementDebit, type CardFormState } from "./actions";

const initial: CardFormState = { ok: false, message: null };

/**
 * Pagamentos de uma fatura (ADR-0043): o pagamento principal, os outros débitos ligados a ela e os débitos do
 * banco que parecem ser dela. Juntar e desligar são sempre escolha de quem está na tela.
 */
export function StatementPaymentsPanel({
  cardId,
  month,
  total,
  carried,
  payments,
  accountNames,
  writable,
}: {
  cardId: string;
  month: string;
  /** Total das compras da fatura. */
  total: string;
  /** O que a fatura levou para a seguinte, quando paga em parte. */
  carried: string | undefined;
  payments: StatementPayments | undefined;
  accountNames: Record<string, string>;
  writable: boolean;
}) {
  const t = useTranslations("cartoes.parts");
  const locale = useLocale();
  const moneyText = useMoney();
  const [joining, setJoining] = useState<StatementDebit | null>(null);
  const [splitting, setSplitting] = useState<{ debit: StatementDebit; main: boolean } | null>(null);
  if (!payments) return null;
  const linked = [
    ...(payments.main ? [{ debit: payments.main, main: true }] : []),
    ...payments.parts.map((debit) => ({ debit, main: false })),
  ];
  // Um pagamento só, marcado à mão e sem nada a sugerir: a fatura já diz que está paga.
  if (
    payments.parts.length === 0 &&
    payments.suggestions.length === 0 &&
    !payments.main?.detachable
  ) {
    return null;
  }

  // Dois débitos podem ter a mesma descrição do banco: o nome do botão leva também o dia e o valor.
  const described = (debit: StatementDebit) => ({
    name: debit.description,
    date: formatDayMonth(debit.date, locale),
    amount: moneyText(debit.amount),
  });
  const row = (debit: StatementDebit) => (
    <div className="min-w-0 flex-1">
      <p className="m-0 break-words font-medium">{debit.description}</p>
      <p className="m-0 text-xs text-muted">
        {formatDayMonth(debit.date, locale)}
        {accountNames[debit.accountId] ? ` · ${accountNames[debit.accountId]}` : ""}
      </p>
    </div>
  );

  return (
    <section className="mt-4 rounded-xl border border-line bg-card-soft p-4 text-sm">
      {linked.length > 0 ? (
        <>
          <h3 className="m-0 text-sm font-semibold">{t("title")}</h3>
          <p className="m-0 mt-0.5 text-xs text-muted">
            {t("summary", { paid: moneyText(payments.paid), total: moneyText(total) })}
          </p>
          <ul aria-label={t("list")} className="m-0 mt-2 list-none divide-y divide-line p-0">
            {linked.map(({ debit, main }) => (
              <li key={debit.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                {row(debit)}
                <Badge>{t(debit.fromBank ? "fromBank" : "byHand")}</Badge>
                <span className="whitespace-nowrap font-semibold tabular-nums">
                  {moneyText(debit.amount)}
                </span>
                {writable && debit.detachable ? (
                  <Button
                    variant="ghost"
                    small
                    aria-label={t("detachLabel", described(debit))}
                    onClick={() => setSplitting({ debit, main })}
                  >
                    <Link2Off className="size-4" aria-hidden="true" />
                    {t("detach")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {payments.suggestions.length > 0 ? (
        <div className={linked.length > 0 ? "mt-4" : ""}>
          <h3 className="m-0 text-sm font-semibold">{t("suggestionsTitle")}</h3>
          <p className="m-0 mt-0.5 text-xs text-muted">{t("suggestionsHint")}</p>
          <ul
            aria-label={t("suggestionsList")}
            className="m-0 mt-2 list-none divide-y divide-line p-0"
          >
            {payments.suggestions.map((debit) => (
              <li key={debit.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                {row(debit)}
                <span className="whitespace-nowrap font-semibold tabular-nums">
                  {moneyText(debit.amount)}
                </span>
                {writable ? (
                  <Button
                    variant="secondary"
                    small
                    aria-label={t("joinLabel", described(debit))}
                    onClick={() => setJoining(debit)}
                  >
                    <Link2 className="size-4" aria-hidden="true" />
                    {t("join")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Sheet open={joining !== null} onClose={() => setJoining(null)} title={t("joinTitle")}>
        {joining ? (
          <JoinForm
            key={joining.id}
            cardId={cardId}
            month={month}
            debit={joining}
            total={total}
            carried={carried}
            payments={payments}
            onDone={() => setJoining(null)}
          />
        ) : null}
      </Sheet>
      <ConfirmSheet
        open={splitting !== null}
        onClose={() => setSplitting(null)}
        title={t("detachTitle")}
        text={t(splitting?.main ? "detachMainText" : "detachText")}
        confirmLabel={t("detachConfirm")}
        action={splitStatementDebit}
        hidden={{ id: splitting?.debit.id ?? "" }}
      >
        {splitting ? (
          <div className="flex items-start gap-3 text-sm">
            {row(splitting.debit)}
            <span className="whitespace-nowrap font-semibold tabular-nums">
              {moneyText(splitting.debit.amount)}
            </span>
          </div>
        ) : null}
      </ConfirmSheet>
    </section>
  );
}

function JoinForm({
  cardId,
  month,
  debit,
  total,
  carried,
  payments,
  onDone,
}: {
  cardId: string;
  month: string;
  debit: StatementDebit;
  total: string;
  carried: string | undefined;
  payments: StatementPayments;
  onDone: () => void;
}) {
  const t = useTranslations("cartoes.parts");
  const moneyText = useMoney();
  const [state, action, pending] = useActionState(joinStatementDebit, initial);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  const main = payments.main;
  const carry = carried ?? "0.00";
  const input = {
    amount: debit.amount,
    mainAmount: main?.amount ?? "0.00",
    mainByHand: Boolean(main?.byHand),
    carry,
  };
  // O que o sistema faria sozinho; a pessoa pode trocar quando o pagamento foi marcado à mão.
  const suggested: JoinMode = money(joinReplaces({ ...input, mode: "auto" })).gt(0)
    ? "marcado"
    : "extra";
  const [mode, setMode] = useState<JoinMode>(suggested);
  const replaced = joinReplaces({ ...input, mode });
  const amount = moneyText(debit.amount);

  let text: string;
  if (!main) {
    text = t("joinFirst", { amount });
  } else if (money(replaced).gte(main.amount)) {
    // O débito passa a ser o pagamento. Pagou mais do que estava marcado: o saldo levado diminui.
    const left = statementCarry(total, [
      ...payments.parts.map((part) => part.amount),
      debit.amount,
    ]);
    text =
      money(carry).gt(0) && left !== carry
        ? t("joinMarkedAllCarry", {
            amount,
            marked: moneyText(main.amount),
            from: moneyText(carry),
            to: moneyText(left),
          })
        : t("joinMarkedAll", { amount, marked: moneyText(main.amount) });
  } else if (money(replaced).gt(0)) {
    text = t("joinMarked", {
      amount,
      marked: moneyText(main.amount),
      left: moneyText(toDbAmount(money(main.amount).minus(replaced))),
    });
  } else if (money(carry).gt(0)) {
    // O que sobra para a fatura seguinte depois deste débito.
    const paid = [...payments.parts.map((part) => part.amount), main.amount, debit.amount];
    text = t("joinExtraCarry", {
      amount,
      from: moneyText(carry),
      to: moneyText(statementCarry(total, paid)),
    });
  } else {
    text = t("joinExtra", { amount });
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="cardId" value={cardId} />
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="id" value={debit.id} />
      <p className="m-0 text-sm font-medium">{debit.description}</p>
      {main?.byHand ? (
        <Field label={t("modeLabel")}>
          <Select
            name="mode"
            value={mode}
            onChange={(event) => setMode(event.target.value as JoinMode)}
          >
            <option value="marcado">{t("modeMarked")}</option>
            <option value="extra">{t("modeExtra")}</option>
          </Select>
        </Field>
      ) : (
        <input type="hidden" name="mode" value="auto" />
      )}
      <p className="m-0 text-sm text-muted">{text}</p>
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Button type="submit" disabled={pending}>
        {pending ? t("saving") : t("confirm")}
      </Button>
    </form>
  );
}
