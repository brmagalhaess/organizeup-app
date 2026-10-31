"use client";
import Link from "next/link";
import { useActionState } from "react";
import {
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
import { browseAudit } from "./actions";
import type { AuditRow, AuditState } from "./data";

const columns: Column[] = [
  { key: "label", label: "O que aconteceu", primary: true },
  { key: "target", label: "Alvo" },
  { key: "admin", label: "Quem" },
  { key: "at", label: "Quando" },
];

function Target({ row }: { row: AuditRow }) {
  if (!row.targetShort) return <span className="text-muted">Sem alvo</span>;
  const href = row.familyId ? `/admin/familias/${row.familyId}` : `/admin/usuarios/${row.userId}`;
  return (
    <Link href={href} className="font-mono text-brand-700 underline-offset-2 hover:underline">
      {row.familyId ? "Família" : "Conta"} {row.targetShort}
    </Link>
  );
}

export function AuditBoard({ initial }: { initial: AuditState }) {
  const [state, action, pending] = useActionState(browseAudit, initial);
  const pageForm = (page: number, label: string) => (
    <form onSubmit={submitKeeping(action)}>
      <input type="hidden" name="group" value={state.filters.group} />
      <input type="hidden" name="days" value={state.filters.days} />
      <input type="hidden" name="target" value={state.filters.target} />
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
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(3,minmax(0,1fr))_auto] xl:items-start"
      >
        <input type="hidden" name="page" value="0" />
        <Field label="Tipo">
          <Select name="group" defaultValue={state.filters.group}>
            <option value="acoes">Ações</option>
            <option value="dados">Dados revelados</option>
            <option value="visitas">Visitas e buscas</option>
            <option value="tudo">Tudo</option>
          </Select>
        </Field>
        <Field label="Período">
          <Select name="days" defaultValue={String(state.filters.days)}>
            <option value="7">7 dias</option>
            <option value="30">30 dias</option>
            <option value="90">90 dias</option>
            <option value="0">Tudo</option>
          </Select>
        </Field>
        <Field label="Alvo" hint="Id completo da família ou da conta.">
          <Input
            name="target"
            maxLength={64}
            autoComplete="off"
            defaultValue={state.filters.target}
          />
        </Field>
        <Button type="submit" disabled={pending} className="xl:mt-6.5">
          {pending ? "Filtrando…" : "Filtrar"}
        </Button>
      </form>
      <div className="mt-3">
        <FormMessage message={state.message} />
      </div>

      {state.rows.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            title="Nada registrado neste filtro"
            text="Mude o tipo ou o período para ver mais."
          />
        </div>
      ) : (
        <div className="mt-3">
          <AdminTable
            caption="Registro do painel"
            columns={columns}
            rows={state.rows.map((row) => ({
              id: String(row.id),
              cells: {
                label: row.label,
                target: <Target row={row} />,
                admin: row.admin,
                at: <span className="tabular-nums">{row.at}</span>,
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
