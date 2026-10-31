"use client";
import { Pencil, Plus, Trash2 } from "lucide-react";
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
import { AdultFields, WORK_STATUS_LABEL } from "./person-fields";

const RELATION_LABEL: Record<string, string> = {
  titular: "Titular",
  conjuge: "Cônjuge",
  filho: "Filho(a)",
  pai_mae: "Pai/Mãe",
  outro: "Outro",
};

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
  const [state, action, pending] = useActionState(person ? updatePerson : addPerson, initial);
  const [relation, setRelation] = useState(person?.relation ?? "conjuge");
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      {person ? <input type="hidden" name="id" value={person.id} /> : null}
      <Field label="Nome" error={state.fieldErrors?.name}>
        <Input name="name" required maxLength={120} defaultValue={person?.name ?? ""} />
      </Field>
      {relation === "titular" ? (
        <input type="hidden" name="relation" value="titular" />
      ) : (
        <Field label="Relação" error={state.fieldErrors?.relation}>
          <Select
            name="relation"
            value={relation}
            required
            onChange={(event) => setRelation(event.target.value)}
          >
            <option value="conjuge">Cônjuge</option>
            <option value="filho">Filho(a)</option>
            <option value="pai_mae">Pai/Mãe</option>
            <option value="outro">Outro</option>
          </Select>
        </Field>
      )}
      <Field
        label="Nascimento"
        hint="Só mês e ano. Usado na aposentadoria e em viagens."
        error={state.fieldErrors?.birth}
      >
        <Input name="birth" type="month" defaultValue={person?.birth ?? ""} />
      </Field>
      {isPlanAdult(relation) ? (
        <>
          <AdultFields
            values={person}
            errors={state.fieldErrors}
            pensionHint="INSS ou previdência. Se não sabe, deixe em branco."
          />
          <Field
            label="Idade em que quer parar"
            hint="Usada no plano quando a família não informa o ano. Vazio: 65 anos."
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
        {pending ? "Salvando…" : "Salvar pessoa"}
      </Button>
    </form>
  );
}

export function PeopleBoard({ rows, writable }: { rows: PersonRow[]; writable: boolean }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PersonRow | null>(null);
  const [removing, setRemoving] = useState<PersonRow | null>(null);
  const closeAdd = useCallback(() => setAdding(false), []);
  const closeEdit = useCallback(() => setEditing(null), []);

  return (
    <Card
      title="Pessoas da família"
      description="Elas entram nos planos de aposentadoria e viagens."
      actions={
        writable ? (
          <Button variant="secondary" small onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Adicionar pessoa
          </Button>
        ) : null
      }
    >
      <ul aria-label="Pessoas da família" className="m-0 list-none divide-y divide-line p-0">
        {rows.map((person) => (
          <li key={person.id} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{person.name}</p>
              <p className="text-xs text-muted">
                {RELATION_LABEL[person.relation] ?? person.relation}
                {person.workStatus ? ` · ${WORK_STATUS_LABEL[person.workStatus] ?? ""}` : ""}
              </p>
            </div>
            {person.age !== null ? <Badge>{person.age} anos</Badge> : null}
            {writable ? (
              <IconButton label={`Editar ${person.name}`} onClick={() => setEditing(person)}>
                <Pencil className="size-4" aria-hidden="true" />
              </IconButton>
            ) : null}
            {writable && person.relation !== "titular" ? (
              <IconButton label={`Remover ${person.name}`} onClick={() => setRemoving(person)}>
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            ) : null}
          </li>
        ))}
      </ul>

      <Sheet open={adding} onClose={closeAdd} title="Adicionar pessoa">
        <PersonForm person={null} onDone={closeAdd} />
      </Sheet>
      <Sheet open={editing !== null} onClose={closeEdit} title="Editar pessoa">
        <PersonForm key={editing?.id ?? "nada"} person={editing} onDone={closeEdit} />
      </Sheet>
      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remover pessoa"
        text={`${removing?.name ?? ""} sai da lista da família.`}
        confirmLabel="Remover"
        action={removePerson}
        hidden={{ id: removing?.id ?? "" }}
      />
    </Card>
  );
}
