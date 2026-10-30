"use client";
import { AlertCircle, CalendarX2, Check, Clock, Pencil, Repeat, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { formatBRL, formatShortDate, type MonthEntry } from "@organizeup/domain";
import { useEntryDialog } from "@/components/shell/entry-context";
import {
  Badge,
  Button,
  Card,
  ConfirmSheet,
  EmptyState,
  Field,
  IconButton,
  Input,
  Select,
} from "@/components/ui";
import { confirmEntry, deleteEntry, stopPlan } from "./actions";

interface Named {
  id: string;
  name: string;
}

function StatusBadge({ entry, today }: { entry: MonthEntry; today: string }) {
  if (entry.status === "realizado")
    return (
      <Badge tone="success">
        <Check className="size-3" aria-hidden="true" />
        {entry.kind === "receita" ? "Recebido" : "Pago"}
      </Badge>
    );
  if (entry.date < today)
    return (
      <Badge tone="danger">
        <AlertCircle className="size-3" aria-hidden="true" />
        Atrasado
      </Badge>
    );
  return (
    <Badge>
      <Clock className="size-3" aria-hidden="true" />
      Previsto
    </Badge>
  );
}

function RowActions({
  entry,
  month,
  onEdit,
  onRemove,
  onStop,
}: {
  entry: MonthEntry;
  month: string;
  onEdit: (entry: MonthEntry) => void;
  onRemove: (entry: MonthEntry) => void;
  onStop: (entry: MonthEntry) => void;
}) {
  return (
    <div className="flex items-center gap-1 sm:justify-end">
      {entry.status === "previsto" ? (
        <form action={confirmEntry}>
          <input type="hidden" name="key" value={entry.key} />
          <input type="hidden" name="month" value={month} />
          <Button type="submit" variant="secondary" small>
            {entry.kind === "receita" ? "Receber" : "Pagar"}
          </Button>
        </form>
      ) : null}
      <IconButton label={`Editar ${entry.description}`} onClick={() => onEdit(entry)}>
        <Pencil className="size-4" aria-hidden="true" />
      </IconButton>
      {entry.source === "lancamento" ? (
        <IconButton label={`Excluir ${entry.description}`} onClick={() => onRemove(entry)}>
          <Trash2 className="size-4" aria-hidden="true" />
        </IconButton>
      ) : (
        <IconButton label={`Parar de repetir ${entry.description}`} onClick={() => onStop(entry)}>
          <CalendarX2 className="size-4" aria-hidden="true" />
        </IconButton>
      )}
    </div>
  );
}

export function EntriesTable({
  month,
  today,
  entries,
  categories,
  accounts,
}: {
  month: string;
  today: string;
  entries: MonthEntry[];
  categories: Named[];
  accounts: Named[];
}) {
  const { openNew, openEdit, writable } = useEntryDialog();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [removing, setRemoving] = useState<MonthEntry | null>(null);
  const [stopping, setStopping] = useState<MonthEntry | null>(null);

  const categoryName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const accountName = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);

  const search = query.trim().toLocaleLowerCase("pt-BR");
  const visible = entries.filter(
    (entry) =>
      (!kind || entry.kind === kind) &&
      (!status || entry.status === status) &&
      (!category || entry.categoryId === category) &&
      (!search || entry.description.toLocaleLowerCase("pt-BR").includes(search)),
  );
  const usedCategories = categories.filter((c) => entries.some((e) => e.categoryId === c.id));

  if (entries.length === 0)
    return (
      <Card>
        <EmptyState
          title="Nada por aqui neste mês"
          text="Lance sua renda e suas contas para ver o mês tomar forma."
          action={writable ? <Button onClick={() => openNew()}>Novo lançamento</Button> : null}
        />
      </Card>
    );

  return (
    <Card>
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-[minmax(0,1fr)_repeat(3,11rem)]">
        <div className="col-span-2 xl:col-span-1">
          <Field label="Buscar">
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Descrição"
            />
          </Field>
        </div>
        <Field label="Tipo">
          <Select value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="">Todos</option>
            <option value="receita">Receitas</option>
            <option value="despesa">Despesas</option>
          </Select>
        </Field>
        <Field label="Situação">
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Todas</option>
            <option value="realizado">Pagos e recebidos</option>
            <option value="previsto">Em aberto</option>
          </Select>
        </Field>
        <div className="col-span-2 xl:col-span-1">
          <Field label="Categoria">
            <Select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">Todas</option>
              {usedCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="Nenhum lançamento encontrado"
          text="Tente mudar a busca ou os filtros."
        />
      ) : (
        <div className="relative -mx-5 overflow-x-auto sm:-mx-6">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Lançamentos do mês</caption>
            <thead>
              <tr className="border-y border-line text-left text-xs text-muted">
                <th scope="col" className="py-2 pl-5 pr-3 font-medium sm:pl-6">
                  Data
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Descrição
                </th>
                <th scope="col" className="hidden px-3 py-2 font-medium md:table-cell">
                  Categoria
                </th>
                <th scope="col" className="hidden px-3 py-2 font-medium lg:table-cell">
                  Conta
                </th>
                <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">
                  Situação
                </th>
                <th scope="col" className="py-2 pl-3 pr-5 text-right font-medium sm:pr-3">
                  Valor
                </th>
                {writable ? (
                  <th
                    scope="col"
                    className="hidden py-2 pl-3 pr-5 text-right font-medium sm:table-cell sm:pr-6"
                  >
                    <span className="sr-only">Ações</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => (
                <tr key={entry.key} className="border-b border-line last:border-0">
                  <td className="py-3 pl-5 pr-3 align-top tabular-nums text-muted sm:pl-6">
                    {formatShortDate(entry.date)}
                  </td>
                  <td className="min-w-40 px-3 py-3 align-top">
                    <p className="flex items-center gap-1.5 font-medium">
                      {entry.description}
                      {entry.recurring ? (
                        <Repeat
                          className="size-3.5 shrink-0 text-muted"
                          role="img"
                          aria-label="Repete todo mês"
                        />
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs text-muted md:hidden">
                      {categoryName.get(entry.categoryId)}
                    </p>
                    <div className="mt-1 sm:hidden">
                      <StatusBadge entry={entry} today={today} />
                    </div>
                    {writable ? (
                      <div className="mt-2 sm:hidden">
                        <RowActions
                          entry={entry}
                          month={month}
                          onEdit={openEdit}
                          onRemove={setRemoving}
                          onStop={setStopping}
                        />
                      </div>
                    ) : null}
                  </td>
                  <td className="hidden px-3 py-3 align-top text-muted md:table-cell">
                    {categoryName.get(entry.categoryId)}
                  </td>
                  <td className="hidden px-3 py-3 align-top text-muted lg:table-cell">
                    {accountName.get(entry.accountId)}
                  </td>
                  <td className="hidden px-3 py-3 align-top sm:table-cell">
                    <StatusBadge entry={entry} today={today} />
                  </td>
                  <td className="whitespace-nowrap py-3 pl-3 pr-5 text-right align-top font-semibold tabular-nums sm:pr-3">
                    {entry.kind === "receita" ? "+ " : "− "}
                    {formatBRL(entry.amount)}
                  </td>
                  {writable ? (
                    <td className="hidden py-2 pl-3 pr-5 align-top sm:table-cell sm:pr-6">
                      <RowActions
                        entry={entry}
                        month={month}
                        onEdit={openEdit}
                        onRemove={setRemoving}
                        onStop={setStopping}
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Excluir lançamento"
        text={`"${removing?.description ?? ""}" será apagado. Isso não pode ser desfeito.`}
        confirmLabel="Excluir"
        action={deleteEntry}
        hidden={{ id: removing?.id ?? "" }}
      />
      <ConfirmSheet
        open={stopping !== null}
        onClose={() => setStopping(null)}
        title="Parar de repetir"
        text={`"${stopping?.description ?? ""}" deixa de aparecer a partir deste mês. O que já foi pago continua no histórico.`}
        confirmLabel="Parar de repetir"
        action={stopPlan}
        hidden={{ id: stopping?.id ?? "", month }}
      />
    </Card>
  );
}
