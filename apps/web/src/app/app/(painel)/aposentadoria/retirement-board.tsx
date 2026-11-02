"use client";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";
import { money, type MoneyInput } from "@organizeup/domain";
import {
  Button,
  Card,
  ConfirmSheet,
  EmptyState,
  Field,
  FormMessage,
  IconButton,
  Input,
  Select,
  Sheet,
  submitKeeping,
} from "@/components/ui";
import { formatPercent, toFieldValue } from "@/i18n/format";
import type { loadRetirement } from "@/lib/planning";
import { deleteScenario, saveScenario, type FormState } from "./actions";
import { RetirementChart } from "./retirement-chart";
import { percentValue } from "./stored-number";
import { useBrazilRules, useMoney } from "@/i18n/money";

type Data = Awaited<ReturnType<typeof loadRetirement>>;
type Scenario = Data["scenarios"][number];

const initial: FormState = { ok: false, message: null };

function ScenarioForm({
  scenario,
  data,
  onDone,
}: {
  scenario: Scenario | null;
  data: Data;
  onDone: () => void;
}) {
  const brazil = useBrazilRules();
  const t = useTranslations("aposentadoria.scenarioForm");
  const locale = useLocale();
  const moneyText = useMoney();
  const [state, action, pending] = useActionState(saveScenario, initial);
  const [personId, setPersonId] = useState(scenario?.personId ?? data.people[0]?.id ?? "");
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  const person = data.people.find((row) => row.id === personId);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={scenario?.id ?? ""} />
      <Field label={t("name")}>
        <Input
          name="name"
          required
          maxLength={60}
          placeholder={t("namePlaceholder")}
          defaultValue={scenario?.name}
        />
      </Field>
      <Field label={t("person")}>
        <Select
          name="personId"
          value={personId}
          onChange={(event) => setPersonId(event.target.value)}
        >
          {data.people.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </Select>
      </Field>
      {person && !person.hasBirth ? (
        <Field label={t("birth")} hint={t("birthHint")}>
          <Input name="birth" type="month" required />
        </Field>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("targetAge")}>
          <Input
            name="targetAge"
            inputMode="numeric"
            required
            defaultValue={scenario?.targetAge ?? 65}
          />
        </Field>
        <Field label={t("lifeExpectancy")} hint={t("lifeExpectancyHint")}>
          <Input
            name="lifeExpectancy"
            inputMode="numeric"
            required
            defaultValue={scenario?.lifeExpectancy ?? 90}
          />
        </Field>
      </div>
      <Field label={t("targetIncome")} hint={t("targetIncomeHint")}>
        <Input
          name="targetIncome"
          inputMode="decimal"
          required
          placeholder={t("targetIncomePlaceholder")}
          defaultValue={toFieldValue(scenario?.targetIncome, locale)}
        />
      </Field>
      {brazil ? (
        <Field label={t("otherIncome")} hint={t("otherIncomeHint")}>
          <Input
            name="otherIncome"
            inputMode="decimal"
            placeholder={t("amountPlaceholder")}
            defaultValue={toFieldValue(scenario?.otherIncome, locale)}
          />
        </Field>
      ) : null}
      <Field label={t("saved")} hint={t("savedHint", { amount: moneyText(data.portfolio) })}>
        <Input
          name="saved"
          inputMode="decimal"
          placeholder={t("savedPlaceholder")}
          defaultValue={toFieldValue(scenario?.saved, locale)}
        />
      </Field>
      <Field label={t("contribution")}>
        <Input
          name="monthlyContribution"
          inputMode="decimal"
          placeholder={t("amountPlaceholder")}
          defaultValue={toFieldValue(scenario?.monthlyContribution, locale)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("returnBefore")} hint={t("returnHint")}>
          <Input
            name="returnBefore"
            inputMode="decimal"
            required
            defaultValue={toFieldValue(scenario?.returnBefore ?? "4.00", locale)}
          />
        </Field>
        <Field label={t("returnAfter")} hint={t("returnHint")}>
          <Input
            name="returnAfter"
            inputMode="decimal"
            required
            defaultValue={toFieldValue(scenario?.returnAfter ?? "2.00", locale)}
          />
        </Field>
      </div>
      <p className="text-xs text-muted">{t("returnNote")}</p>
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? t("saving") : t("save")}
      </Button>
    </form>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="m-0 font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function ScenarioCard({
  scenario,
  writable,
  onEdit,
  onRemove,
}: {
  scenario: Scenario;
  writable: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations("aposentadoria.scenario");
  const locale = useLocale();
  const moneyText = useMoney();
  const amount = (value: MoneyInput) => moneyText(value);
  const { result } = scenario;
  const required = result.requiredContribution;
  const extra = required === null ? null : money(required).minus(scenario.monthlyContribution);
  return (
    <Card
      title={scenario.name}
      description={t("description", {
        name: scenario.personName,
        age: scenario.age,
        targetAge: scenario.targetAge,
      })}
      actions={
        writable ? (
          <div className="flex">
            <IconButton label={t("edit", { name: scenario.name })} onClick={onEdit}>
              <Pencil className="size-4" aria-hidden="true" />
            </IconButton>
            <IconButton label={t("remove", { name: scenario.name })} onClick={onRemove}>
              <Trash2 className="size-4" aria-hidden="true" />
            </IconButton>
          </div>
        ) : null
      }
    >
      <div className="text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-medium">
            {result.percent >= 100
              ? t("closes")
              : t("percentOfNeeded", { percent: formatPercent(result.percent, locale) })}
          </span>
          <span className="tabular-nums text-muted">
            {t("projectedOfNeeded", {
              projected: amount(result.projected),
              needed: amount(result.needed),
            })}
          </span>
        </div>
        <div className="mt-1.5 h-2 rounded-full bg-brand-50" aria-hidden="true">
          <div className="h-2 rounded-full bg-brand-500" style={{ width: `${result.percent}%` }} />
        </div>
      </div>

      <dl className="m-0 mt-4 grid grid-cols-1 gap-3 rounded-xl bg-card-soft p-4 text-sm sm:grid-cols-3">
        <Fact
          label={t("requiredContribution")}
          value={
            required === null ? t("alreadyStopped") : t("perMonth", { amount: amount(required) })
          }
        />
        <Fact
          label={t("sustainableIncome")}
          value={t("perMonth", { amount: amount(result.sustainableIncome) })}
        />
        <Fact
          label={t("lasts")}
          value={t("untilAge", { age: result.runsOutAtAge ?? scenario.lifeExpectancy })}
        />
      </dl>
      {extra !== null && extra.gt(0) ? (
        <p className="mt-3 text-sm">{t("extra", { amount: amount(extra) })}</p>
      ) : null}

      <div className="mt-4">
        <RetirementChart points={result.series} targetAge={scenario.targetAge} />
      </div>
      <p className="mt-3 text-xs text-muted">
        {t("assumptions", {
          before: percentValue(scenario.returnBefore, locale),
          after: percentValue(scenario.returnAfter, locale),
        })}
      </p>
    </Card>
  );
}

export function RetirementBoard({
  data,
  writable,
  startOpen,
}: {
  data: Data;
  writable: boolean;
  /** Sem plano de rendimentos válido, ou com cenários já criados, a comparação começa aberta. */
  startOpen: boolean;
}) {
  const t = useTranslations("aposentadoria.compare");
  const [editing, setEditing] = useState<{ nonce: number; scenario: Scenario | null } | null>(null);
  const [removing, setRemoving] = useState<Scenario | null>(null);
  const [expanded, setExpanded] = useState(startOpen);
  const close = () => setEditing(null);
  const open = (scenario: Scenario | null) =>
    setEditing((s) => ({ nonce: (s?.nonce ?? 0) + 1, scenario }));
  const untilAge = data.scenarios[0]?.lifeExpectancy ?? 90;

  return (
    <div>
      <details open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
        <summary className="cursor-pointer rounded-2xl border border-line bg-card p-4 shadow-card sm:px-6">
          <span className="font-semibold">{t("title")}</span>
          <span className="mt-0.5 block text-sm text-muted">
            {t("description", { age: untilAge })}
          </span>
        </summary>

        <div className="mt-4 flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">{t("intro")}</p>
            {writable ? (
              <Button variant="secondary" onClick={() => open(null)}>
                <Plus className="size-4" aria-hidden="true" />
                {t("add")}
              </Button>
            ) : null}
          </div>

          {data.scenarios.length === 0 ? (
            <Card>
              <EmptyState
                title={t("emptyTitle")}
                text={t("emptyText")}
                action={
                  writable ? (
                    <Button variant="secondary" small onClick={() => open(null)}>
                      {t("emptyAction")}
                    </Button>
                  ) : undefined
                }
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
              {data.scenarios.map((scenario) => (
                <ScenarioCard
                  key={scenario.id}
                  scenario={scenario}
                  writable={writable}
                  onEdit={() => open(scenario)}
                  onRemove={() => setRemoving(scenario)}
                />
              ))}
            </div>
          )}

          <p className="text-xs text-muted">{t("disclaimer")}</p>
        </div>
      </details>

      <Sheet
        open={editing !== null}
        onClose={close}
        title={editing?.scenario ? t("editTitle") : t("add")}
      >
        <ScenarioForm
          key={editing?.nonce}
          scenario={editing?.scenario ?? null}
          data={data}
          onDone={close}
        />
      </Sheet>
      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t("removeTitle")}
        text={t("removeText", { name: removing?.name ?? "" })}
        confirmLabel={t("removeConfirm")}
        action={deleteScenario}
        hidden={{ id: removing?.id ?? "" }}
      />
    </div>
  );
}
