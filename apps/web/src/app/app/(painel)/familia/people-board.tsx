"use client";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useCallback, useEffect, useState } from "react";
import { addPerson, removePerson, updatePerson, type ActionState } from "@/app/app/actions";
import {
  Badge,
  Button,
  Card,
  ConfirmSheet,
  Field,
  FormMessage,
  IconButton,
  Input,
  Select,
  Sheet,
  submitKeeping,
} from "@/components/ui";
import { AdultFields, type WorkStatus } from "./person-fields";

/** Quem pode ser cadastrado; o titular nasce com a família. */
const RELATIONS = ["conjuge", "filho", "pai_mae", "outro"] as const;
type Relation = "titular" | (typeof RELATIONS)[number];

export interface PersonRow {
  id: string;
  name: string;
  relation: string;
  age: number | null;
  birth: string;
  workStatus: string;
  inssContributor: boolean | null;
  expectedPension: string;
  retirementAge: number | null;
}

const initial: ActionState = { ok: false, message: null };

const isPlanAdult = (relation: string) => relation === "titular" || relation === "conjuge";

function PersonForm({ person, onDone }: { person: PersonRow | null; onDone: () => void }) {
  const t = useTranslations("pessoas");
  const tCommon = useTranslations("common");
  const [state, action, pending] = useActionState(person ? updatePerson : addPerson, initial);
  const [relation, setRelation] = useState(person?.relation ?? "conjuge");
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      {person ? <input type="hidden" name="id" value={person.id} /> : null}
      <Field label={t("form.name")} error={state.fieldErrors?.name}>
        <Input name="name" required maxLength={120} defaultValue={person?.name ?? ""} />
      </Field>
      {relation === "titular" ? (
        <input type="hidden" name="relation" value="titular" />
      ) : (
        <Field label={t("form.relation")} error={state.fieldErrors?.relation}>
          <Select
            name="relation"
            value={relation}
            required
            onChange={(event) => setRelation(event.target.value)}
          >
            {RELATIONS.map((value) => (
              <option key={value} value={value}>
                {t(`relations.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={t("form.birth")} hint={t("form.birthHint")} error={state.fieldErrors?.birth}>
        <Input name="birth" type="month" defaultValue={person?.birth ?? ""} />
      </Field>
      {isPlanAdult(relation) ? (
        <>
          <AdultFields
            values={person}
            errors={state.fieldErrors}
            pensionHint={t("form.pensionHint")}
          />
          <Field
            label={t("form.retirementAge")}
            hint={t("form.retirementAgeHint")}
            error={state.fieldErrors?.retirementAge}
          >
            <Input
              name="retirementAge"
              type="number"
              inputMode="numeric"
              min={40}
              max={100}
              defaultValue={person?.retirementAge ?? ""}
            />
          </Field>
        </>
      ) : null}
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Button type="submit" disabled={pending}>
        {pending ? tCommon("saving") : t("form.save")}
      </Button>
    </form>
  );
}

export function PeopleBoard({ rows, writable }: { rows: PersonRow[]; writable: boolean }) {
  const t = useTranslations("pessoas");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PersonRow | null>(null);
  const [removing, setRemoving] = useState<PersonRow | null>(null);
  const closeAdd = useCallback(() => setAdding(false), []);
  const closeEdit = useCallback(() => setEditing(null), []);

  return (
    <Card
      title={t("people.title")}
      description={t("people.description")}
      actions={
        writable ? (
          <Button variant="secondary" small onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden="true" />
            {t("people.add")}
          </Button>
        ) : null
      }
    >
      <ul aria-label={t("people.title")} className="m-0 list-none divide-y divide-line p-0">
        {rows.map((person) => {
          const relation = t(`relations.${person.relation as Relation}`);
          return (
            <li key={person.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{person.name}</p>
                <p className="text-xs text-muted">
                  {person.workStatus
                    ? t("people.withWork", {
                        relation,
                        work: t(`workStatuses.${person.workStatus as WorkStatus}`),
                      })
                    : relation}
                </p>
              </div>
              {person.age !== null ? <Badge>{t("people.age", { age: person.age })}</Badge> : null}
              {writable ? (
                <IconButton
                  label={t("people.edit", { name: person.name })}
                  onClick={() => setEditing(person)}
                >
                  <Pencil className="size-4" aria-hidden="true" />
                </IconButton>
              ) : null}
              {writable && person.relation !== "titular" ? (
                <IconButton
                  label={t("people.remove", { name: person.name })}
                  onClick={() => setRemoving(person)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </IconButton>
              ) : null}
            </li>
          );
        })}
      </ul>

      <Sheet open={adding} onClose={closeAdd} title={t("people.add")}>
        <PersonForm person={null} onDone={closeAdd} />
      </Sheet>
      <Sheet open={editing !== null} onClose={closeEdit} title={t("people.editTitle")}>
        <PersonForm key={editing?.id ?? "nada"} person={editing} onDone={closeEdit} />
      </Sheet>
      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t("people.removeTitle")}
        text={t("people.removeText", { name: removing?.name ?? "" })}
        confirmLabel={t("people.removeConfirm")}
        action={removePerson}
        hidden={{ id: removing?.id ?? "" }}
      />
    </Card>
  );
}
