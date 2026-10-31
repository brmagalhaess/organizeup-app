"use client";
import Link from "next/link";
import { useActionState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  FormMessage,
  Input,
  Select,
  submitKeeping,
} from "@/components/ui";
import { AdminTable, Monogram, type Column } from "../kit";
import { browseFamilies } from "./actions";
import type { FamiliesState } from "./data";

const columns: Column[] = [
  { key: "name", label: "Família", primary: true },
  { key: "status", label: "Situação" },
  { key: "members", label: "Membros", align: "right" },
  { key: "onboarding", label: "Cadastro" },
  { key: "lastSession", label: "Última sessão" },
  { key: "createdAt", label: "Criada em" },
];

export function FamiliesBoard({ initial }: { initial: FamiliesState }) {
  const [state, action, pending] = useActionState(browseFamilies, initial);
  const filtered =
    state.q !== "" ||
    state.filters.status !== "todas" ||
    state.filters.onboarding !== "todos" ||
    state.filters.activity !== "todas";
  const hiddenFilters = (
    <>
      <input type="hidden" name="q" value={state.q} />
      <input type="hidden" name="status" value={state.filters.status} />
      <input type="hidden" name="onboarding" value={state.filters.onboarding} />
      <input type="hidden" name="activity" value={state.filters.activity} />
    </>
  );
  const pageForm = (page: number, label: string) => (
    <form onSubmit={submitKeeping(action)}>
      {hiddenFilters}
      <input type="hidden" name="page" value={page} />
      <Button type="submit" variant="secondary" small disabled={pending}>
        {label}
      </Button>
    </form>
  );

  return (
    <Card>
      <form
        role="search"
        onSubmit={submitKeeping(action)}
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto] xl:items-start"
      >
        <input type="hidden" name="page" value="0" />
        <Field label="Buscar" hint="Nome da família ou e-mail exato de um membro.">
          <Input name="q" type="search" maxLength={200} autoComplete="off" defaultValue={state.q} />
        </Field>
        <Field label="Situação">
          <Select name="status" defaultValue={state.filters.status}>
            <option value="todas">Todas</option>
            <option value="ativas">Em uso</option>
            <option value="suspensas">Suspensas</option>
          </Select>
        </Field>
        <Field label="Cadastro complementar">
          <Select name="onboarding" defaultValue={state.filters.onboarding}>
            <option value="todos">Todos</option>
            <option value="completo">Completo</option>
            <option value="pendente">Pendente</option>
          </Select>
        </Field>
        <Field label="Atividade">
          <Select name="activity" defaultValue={state.filters.activity}>
            <option value="todas">Todas</option>
            <option value="recentes">Ativa em 30 dias</option>
            <option value="paradas">Parada há 30 dias</option>
          </Select>
        </Field>
        <Button type="submit" disabled={pending} className="xl:mt-6.5">
          {pending ? "Buscando…" : "Buscar"}
        </Button>
      </form>
      <div className="mt-3">
        <FormMessage message={state.message} />
      </div>

      {state.rows.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            title={filtered ? "Nenhuma família encontrada" : "Nenhuma família ainda"}
            text={filtered ? "Confira o que foi buscado ou limpe os filtros." : undefined}
          />
        </div>
      ) : (
        <div className="mt-3">
          <AdminTable
            caption="Famílias"
            columns={columns}
            rows={state.rows.map((row) => ({
              id: row.id,
              cells: {
                name: (
                  <Monogram name={row.name}>
                    <Link
                      href={`/admin/familias/${row.id}`}
                      className="font-medium text-brand-700 underline-offset-2 hover:underline"
                    >
                      {row.name}
                    </Link>
                  </Monogram>
                ),
                status: row.suspended ? (
                  <Badge tone="danger">Suspensa</Badge>
                ) : (
                  <Badge tone="success">Em uso</Badge>
                ),
                members: row.members,
                onboarding: (
                  <Badge tone={row.onboardingDone ? "success" : "warning"}>
                    {row.onboardingDone ? "Completo" : "Pendente"}
                  </Badge>
                ),
                lastSession: row.lastSession,
                createdAt: row.createdAt,
              },
            }))}
          />
        </div>
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
