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
import { AdminTable, type Column } from "../kit";
import { browseUsers } from "./actions";
import type { UsersState } from "./data";

const columns: Column[] = [
  { key: "account", label: "Conta", primary: true },
  { key: "status", label: "Situação" },
  { key: "families", label: "Famílias", align: "right" },
  { key: "verified", label: "E-mail" },
  { key: "lastAccess", label: "Último acesso" },
  { key: "createdAt", label: "Criada em" },
];

export function UsersBoard({ initial }: { initial: UsersState }) {
  const [state, action, pending] = useActionState(browseUsers, initial);
  const filtered = state.q !== "" || state.status !== "todos";
  const pageForm = (page: number, label: string) => (
    <form onSubmit={submitKeeping(action)}>
      <input type="hidden" name="q" value={state.q} />
      <input type="hidden" name="status" value={state.status} />
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
        className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-start"
      >
        <input type="hidden" name="page" value="0" />
        <Field label="Buscar" hint="E-mail exato ou id da conta.">
          <Input name="q" type="search" maxLength={200} autoComplete="off" defaultValue={state.q} />
        </Field>
        <Field label="Situação">
          <Select name="status" defaultValue={state.status}>
            <option value="todos">Todas</option>
            <option value="bloqueados">Bloqueadas</option>
            <option value="nao_verificados">E-mail não verificado</option>
            <option value="sem_familia">Sem família</option>
          </Select>
        </Field>
        <Button type="submit" disabled={pending} className="sm:mt-6.5">
          {pending ? "Buscando…" : "Buscar"}
        </Button>
      </form>
      <div className="mt-3">
        <FormMessage message={state.message} />
      </div>

      {state.rows.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            title={filtered ? "Nenhuma conta encontrada" : "Nenhuma conta ainda"}
            text={filtered ? "Confira o que foi buscado ou limpe os filtros." : undefined}
          />
        </div>
      ) : (
        <div className="mt-3">
          <AdminTable
            caption="Usuários"
            columns={columns}
            rows={state.rows.map((row) => ({
              id: row.id,
              cells: {
                account: (
                  <Link
                    href={`/admin/usuarios/${row.id}`}
                    className="font-mono text-brand-700 underline-offset-2 hover:underline"
                  >
                    {row.shortId}
                  </Link>
                ),
                status: row.blocked ? (
                  <Badge tone="danger">Bloqueada</Badge>
                ) : (
                  <Badge tone="success">Liberada</Badge>
                ),
                families: row.owner ? `${row.households} (responsável)` : row.households,
                verified: row.verified ? "Verificado" : "Não verificado",
                lastAccess: row.lastAccess,
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
