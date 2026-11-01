"use client";
import { Pause, Pencil, PiggyBank, Play, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useActionState, useEffect, useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  Card,
  ConfirmSheet,
  EmptyState,
  Field,
  FormMessage,
  IconButton,
  Input,
  PageHeader,
  Select,
  Sheet,
  StatTile,
  submitKeeping,
} from "@/components/ui";
import { formatAmount, formatMonthYear, toFieldValue } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import type { loadGoals } from "@/lib/goals";
import { confirmEntry } from "../lancamentos/actions";
import {
  addSavedToGoal,
  deleteGoal,
  replanNow,
  saveGoal,
  setGoalStatus,
  type FormState,
} from "./actions";

type Data = Awaited<ReturnType<typeof loadGoals>>;
type Goal = Data["goals"][number];

const KINDS = ["veiculo", "imovel", "reforma", "educacao", "compra", "evento", "outro"] as const;
const PRIORITIES = [1, 2, 3, 4, 5] as const;

const initial: FormState = { ok: false, message: null };

/** Mês em números: "10/2026". */
const numericMonth = (month: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale, { month: "2-digit", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${month}-15T12:00:00Z`),
  );

/** Valor do banco de volta ao campo, com os centavos: "50000.00" vira "50000,00" em português. */
function useClose(state: FormState, onDone: () => void) {
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
}

function GoalForm({ goal, data, onDone }: { goal: Goal | null; data: Data; onDone: () => void }) {
  const t = useTranslations("metas");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [state, action, pending] = useActionState(saveGoal, initial);
  useClose(state, onDone);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={goal?.id ?? ""} />
      <Field label={t("form.name")}>
        <Input
          name="name"
          required
          maxLength={80}
          placeholder={t("form.namePlaceholder")}
          defaultValue={goal?.name}
        />
      </Field>
      <Field label={t("form.kind")}>
        <Select name="kind" defaultValue={goal?.kind ?? "compra"}>
          {KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(`kinds.${kind}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("form.amount")}>
        <Input
          name="targetAmount"
          inputMode="decimal"
          required
          placeholder={t("form.amountPlaceholder")}
          defaultValue={goal ? toFieldValue(goal.targetAmount, locale) : undefined}
        />
      </Field>
      <Field label={t("form.desiredMonth")} hint={t("form.optional")}>
        <Input name="desiredMonth" type="month" defaultValue={goal?.desiredMonth ?? ""} />
      </Field>
      <Field label={t("form.priority")}>
        <Select name="priority" defaultValue={goal?.priority ?? 3}>
          {PRIORITIES.map((value) => (
            <option key={value} value={value}>
              {t(`form.priorities.${value}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("form.planDay")}>
        <Input
          name="planDay"
          type="number"
          min={1}
          max={28}
          required
          defaultValue={goal?.planDay ?? data.defaults.planDay}
        />
      </Field>
      <Field label={t("form.account")}>
        <Select name="accountId" defaultValue={goal?.accountId ?? data.defaults.accountId}>
          {data.accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("form.destination")} hint={t("form.destinationHint")}>
        <Select name="destinationAccountId" defaultValue={goal?.destinationAccountId ?? ""}>
          <option value="">{t("form.noAccount")}</option>
          {data.accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </Select>
      </Field>
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? tCommon("saving") : t("form.save")}
      </Button>
    </form>
  );
}

function SavedForm({ goal, onDone }: { goal: Goal; onDone: () => void }) {
  const t = useTranslations("metas");
  const tCommon = useTranslations("common");
  const [state, action, pending] = useActionState(addSavedToGoal, initial);
  useClose(state, onDone);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={goal.id} />
      <Field label={t("saved.amount")} hint={t("saved.hint")}>
        <Input
          name="amount"
          inputMode="decimal"
          required
          placeholder={t("form.amountPlaceholder")}
        />
      </Field>
      <p className="text-xs text-muted">{t("saved.note")}</p>
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? tCommon("saving") : t("saved.save")}
      </Button>
    </form>
  );
}

function GoalBadge({ goal }: { goal: Goal }) {
  const t = useTranslations("metas.badge");
  if (goal.status === "concluida") return <Badge tone="success">{t("achieved")}</Badge>;
  if (goal.status === "pausada") return <Badge>{t("paused")}</Badge>;
  if (!goal.planned) return <Badge>{t("preparing")}</Badge>;
  if (goal.planMonthly === null) return <Badge tone="warning">{t("noRoom")}</Badge>;
  return null;
}

function PlanText({ goal }: { goal: Goal }) {
  const t = useTranslations("metas.plan");
  const locale = useLocale();
  if (!goal.active) return null;
  if (!goal.planned) return <p className="mt-2 text-sm text-muted">{t("pending")}</p>;
  const note = goal.planNote;
  if (goal.planMonthly === null)
    return (
      <>
        <p className="mt-2 text-sm">{t("noRoom")}</p>
        {note && !note.startsWith("Hoje não sobra") ? (
          <p className="mt-1 text-xs text-muted">{note}</p>
        ) : null}
      </>
    );
  return (
    <>
      {goal.planStart && goal.planEnd ? (
        <p className="mt-2 text-sm">
          {t.rich("monthly", {
            amount: formatAmount(goal.planMonthly, locale),
            start: formatMonthYear(goal.planStart, locale),
            end: formatMonthYear(goal.planEnd, locale),
            strong: (chunks) => <strong className="tabular-nums">{chunks}</strong>,
          })}
        </p>
      ) : null}
      {note ? <p className="mt-1 text-xs text-muted">{note}</p> : null}
    </>
  );
}

function GoalCard({
  goal,
  writable,
  onEdit,
  onSaved,
  onRemove,
}: {
  goal: Goal;
  writable: boolean;
  onEdit: () => void;
  onSaved: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations("metas");
  const locale = useLocale();
  const paused = goal.status === "pausada";
  const name = goal.name;
  const kind = t(`kinds.${goal.kind}`);
  return (
    <Card
      title={name}
      description={
        goal.desiredMonth
          ? t("card.kindFor", { kind, month: formatMonthYear(goal.desiredMonth, locale) })
          : kind
      }
      actions={
        writable ? (
          <div className="flex">
            <IconButton label={t("card.edit", { name })} onClick={onEdit}>
              <Pencil className="size-4" aria-hidden="true" />
            </IconButton>
            <IconButton label={t("card.delete", { name })} onClick={onRemove}>
              <Trash2 className="size-4" aria-hidden="true" />
            </IconButton>
          </div>
        ) : null
      }
    >
      <GoalBadge goal={goal} />
      <div className="mt-2 flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium tabular-nums">{formatAmount(goal.targetAmount, locale)}</span>
        <span className="tabular-nums text-muted">
          {t("card.saved", { amount: formatAmount(goal.saved, locale) })}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={t("card.progress", { name })}
        aria-valuenow={goal.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-1.5 h-2 rounded-full bg-brand-50"
      >
        <div className="h-2 rounded-full bg-brand-500" style={{ width: `${goal.percent}%` }} />
      </div>
      <PlanText goal={goal} />

      {goal.overdue.length > 0 ? (
        <ul
          aria-label={t("card.overdue", { name })}
          className="m-0 mt-3 list-none divide-y divide-line p-0"
        >
          {goal.overdue.map((row) => (
            <li key={row.key} className="flex items-center gap-3 py-1.5 text-sm">
              <span className="min-w-0 flex-1 first-letter:uppercase">
                {formatMonthYear(row.month, locale)}
                <span className="block font-medium tabular-nums">
                  {formatAmount(row.amount, locale)}
                </span>
              </span>
              {writable ? (
                <form action={confirmEntry}>
                  <input type="hidden" name="key" value={row.key} />
                  <input type="hidden" name="month" value={row.month} />
                  <Button
                    type="submit"
                    variant="secondary"
                    small
                    aria-label={t("card.confirmAria", {
                      month: formatMonthYear(row.month, locale),
                      name,
                    })}
                  >
                    {t("card.confirm")}
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {writable && goal.status !== "concluida" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            small
            aria-label={t("card.savedAria", { name })}
            onClick={onSaved}
          >
            <PiggyBank className="size-4" aria-hidden="true" />
            {t("card.savedButton")}
          </Button>
          <form action={setGoalStatus}>
            <input type="hidden" name="id" value={goal.id} />
            <input type="hidden" name="status" value={paused ? "planejando" : "pausada"} />
            <Button
              type="submit"
              variant="secondary"
              small
              aria-label={t(paused ? "card.resumeAria" : "card.pauseAria", { name })}
            >
              {paused ? (
                <Play className="size-4" aria-hidden="true" />
              ) : (
                <Pause className="size-4" aria-hidden="true" />
              )}
              {paused ? t("card.resume") : t("card.pause")}
            </Button>
          </form>
        </div>
      ) : null}
    </Card>
  );
}

function Replan() {
  const t = useTranslations("metas.replan");
  const [state, action, pending] = useActionState(replanNow, initial);
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <Button type="submit" variant="secondary" small disabled={pending}>
        <RefreshCw className="size-4" aria-hidden="true" />
        {pending ? t("running") : t("run")}
      </Button>
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
    </form>
  );
}

type Open = { type: "new" | "edit" | "saved"; nonce: number; id: string | null };

export function GoalsBoard({
  data,
  writable,
  insights,
}: {
  data: Data;
  writable: boolean;
  insights: ReactNode;
}) {
  const t = useTranslations("metas");
  const locale = useLocale();
  const [sheet, setSheet] = useState<Open | null>(null);
  const [removing, setRemoving] = useState<Goal | null>(null);
  const close = () => setSheet(null);
  const open = (type: Open["type"], id: string | null) =>
    setSheet((s) => ({ type, id, nonce: (s?.nonce ?? 0) + 1 }));
  const selected = data.goals.find((goal) => goal.id === sheet?.id) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t("header.eyebrow")}
        title={t("header.title")}
        description={t("header.description")}
        actions={
          writable && data.goals.length > 0 ? (
            <Button variant="secondary" onClick={() => open("new", null)}>
              <Plus className="size-4" aria-hidden="true" />
              {t("header.newGoal")}
            </Button>
          ) : null
        }
      />
      {insights}

      {data.goals.length === 0 ? (
        <Card>
          <EmptyState
            title={t("empty.title")}
            text={t("empty.text")}
            action={
              writable ? (
                <Button onClick={() => open("new", null)}>{t("empty.create")}</Button>
              ) : null
            }
          />
        </Card>
      ) : (
        <>
          <dl className="m-0 grid grid-cols-2 gap-4">
            <StatTile
              label={t("stats.monthly")}
              value={formatAmount(data.nextMonthTotal, locale)}
              hint={
                data.nextMonth
                  ? t("stats.monthlyHint", { month: formatMonthYear(data.nextMonth, locale) })
                  : t("stats.noInstallments")
              }
            />
            <StatTile
              label={t("stats.next")}
              value={data.nextGoal ? numericMonth(data.nextGoal.end, locale) : t("stats.none")}
              hint={data.nextGoal?.name}
            />
          </dl>
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
            {data.goals.map((goal) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                writable={writable}
                onEdit={() => open("edit", goal.id)}
                onSaved={() => open("saved", goal.id)}
                onRemove={() => setRemoving(goal)}
              />
            ))}
          </div>
          {writable ? <Replan /> : null}
        </>
      )}

      <p className="text-xs text-muted">{t("footnote")}</p>

      <Sheet open={sheet !== null} onClose={close} title={sheet ? t(`sheets.${sheet.type}`) : ""}>
        {sheet?.type === "new" ? (
          <GoalForm key={sheet.nonce} goal={null} data={data} onDone={close} />
        ) : null}
        {sheet?.type === "edit" && selected ? (
          <GoalForm key={sheet.nonce} goal={selected} data={data} onDone={close} />
        ) : null}
        {sheet?.type === "saved" && selected ? (
          <SavedForm key={sheet.nonce} goal={selected} onDone={close} />
        ) : null}
      </Sheet>
      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t("remove.title")}
        text={t("remove.text", { name: removing?.name ?? "" })}
        confirmLabel={t("remove.confirm")}
        action={deleteGoal}
        hidden={{ id: removing?.id ?? "" }}
      />
    </div>
  );
}
