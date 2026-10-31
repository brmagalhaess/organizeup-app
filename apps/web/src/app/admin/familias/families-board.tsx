"use client";
import { useActionState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  FormMessage,
  Input,
  submitKeeping,
} from "@/components/ui";
import { browseFamilies, revealOwnerEmail } from "./actions";
import type { FamiliesState, FamilyRow } from "./data";

function OwnerEmail({ id, family }: { id: string; family: string }) {
  const [state, action, pending] = useActionState(revealOwnerEmail, { email: null, message: null });
  if (state.email) {
    return (
      <p className="text-sm">
        <span className="text-muted">Responsável: </span>
        <span className="break-all">{state.email}</span>
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <Button
        type="submit"
        variant="secondary"
        small
        disabled={pending}
        aria-label={`Ver e-mail do responsável de ${family}`}
      >
        Ver e-mail do responsável
      </Button>
      <FormMessage message={state.message} />
    </form>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="m-0 tabular-nums">{children}</dd>
    </div>
  );
}

function Family({ row }: { row: FamilyRow }) {
  return (
    <li className="flex flex-col gap-3 border-b border-line py-4 last:border-0 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 flex-1">
        <p className="font-medium break-words">{row.name}</p>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-4">
          <Detail label="Criada em">{row.createdAt}</Detail>
          <Detail label="Membros">{row.members}</Detail>
          <Detail label="Última sessão">{row.lastSession}</Detail>
          <Detail label="Cadastro complementar">
            <Badge tone={row.onboardingDone ? "success" : "warning"}>
              {row.onboardingDone ? "Completo" : "Pendente"}
            </Badge>
          </Detail>
        </dl>
      </div>
      <OwnerEmail id={row.id} family={row.name} />
    </li>
  );
}

export function FamiliesBoard({ initial }: { initial: FamiliesState }) {
  const [state, action, pending] = useActionState(browseFamilies, initial);
  const pageForm = (page: number, label: string) => (
    <form onSubmit={submitKeeping(action)}>
      <input type="hidden" name="q" value={state.q} />
      <input type="hidden" name="page" value={page} />
      <Button type="submit" variant="secondary" small disabled={pending}>
        {label}
      </Button>
    </form>
  );

  return (
    <Card title="Famílias">
      <form
        role="search"
        onSubmit={submitKeeping(action)}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <input type="hidden" name="page" value="0" />
        <div className="min-w-0 flex-1">
          <Field label="Buscar" hint="Nome da família ou e-mail exato de um membro.">
            <Input name="q" type="search" maxLength={200} autoComplete="off" />
          </Field>
        </div>
        <Button type="submit" disabled={pending} className="sm:mb-5">
          {pending ? "Buscando…" : "Buscar"}
        </Button>
      </form>
      <div className="mt-4">
        <FormMessage message={state.message} />
      </div>

      {state.rows.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title={state.q ? "Nenhuma família encontrada" : "Nenhuma família ainda"}
            text={state.q ? "Confira o nome ou o e-mail buscado." : undefined}
          />
        </div>
      ) : (
        <ul aria-label="Famílias" className="mt-2">
          {state.rows.map((row) => (
            <Family key={row.id} row={row} />
          ))}
        </ul>
      )}

      {state.page > 0 || state.hasNext ? (
        <nav aria-label="Páginas" className="mt-4 flex items-center justify-between gap-3">
          {state.page > 0 ? pageForm(state.page - 1, "Anterior") : <span />}
          <span className="text-sm text-muted">Página {state.page + 1}</span>
          {state.hasNext ? pageForm(state.page + 1, "Próxima") : <span />}
        </nav>
      ) : null}
    </Card>
  );
}
