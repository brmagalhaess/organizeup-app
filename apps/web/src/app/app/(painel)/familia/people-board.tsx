"use client";
import { Plus, Trash2 } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { addPerson, removePerson, type ActionState } from "@/app/app/actions";
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
} from "@/components/ui";

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
}

const initial: ActionState = { ok: false, message: null };

function PersonForm({ onDone }: { onDone: () => void }) {
  const [state, action, pending] = useActionState(addPerson, initial);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Nome" error={state.fieldErrors?.name}>
        <Input name="name" required maxLength={120} />
      </Field>
      <Field label="Relação" error={state.fieldErrors?.relation}>
        <Select name="relation" defaultValue="conjuge" required>
          <option value="conjuge">Cônjuge</option>
          <option value="filho">Filho(a)</option>
          <option value="pai_mae">Pai/Mãe</option>
          <option value="outro">Outro</option>
        </Select>
      </Field>
      <Field
        label="Nascimento"
        hint="Só mês e ano. Usado na aposentadoria e em viagens."
        error={state.fieldErrors?.birth}
      >
        <Input name="birth" type="month" />
      </Field>
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando…" : "Salvar pessoa"}
      </Button>
    </form>
  );
}

export function PeopleBoard({ rows, writable }: { rows: PersonRow[]; writable: boolean }) {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<PersonRow | null>(null);

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
              </p>
            </div>
            {person.age !== null ? <Badge>{person.age} anos</Badge> : null}
            {writable && person.relation !== "titular" ? (
              <IconButton label={`Remover ${person.name}`} onClick={() => setRemoving(person)}>
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            ) : null}
          </li>
        ))}
      </ul>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Adicionar pessoa">
        <PersonForm onDone={() => setAdding(false)} />
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
