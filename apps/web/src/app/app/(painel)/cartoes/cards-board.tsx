"use client";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  Lock,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import {
  addMonths,
  formatBRL,
  formatShortDate,
  formatYearMonth,
  linesTotal,
  percentOf,
  statementClosingDate,
  statementDueDate,
  statementStatus,
} from "@organizeup/domain";
import { useEntryDialog } from "@/components/shell/entry-context";
import { buttonClass, cx } from "@/components/styles";
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
} from "@/components/ui";
import type { loadCards } from "@/lib/commitments";
import { confirmEntry } from "../lancamentos/actions";
import { deletePurchase, saveCard, setCardArchived, type CardFormState } from "./actions";

type Data = Awaited<ReturnType<typeof loadCards>>;
type CardView = Data["cards"][number];
type Line = CardView["lines"][number];

const initial: CardFormState = { ok: false, message: null };

const STATUS = {
  aberta: { label: "Aberta", tone: "neutral", icon: Clock },
  fechada: { label: "Fechada", tone: "warning", icon: Lock },
  atrasada: { label: "Atrasada", tone: "danger", icon: AlertCircle },
  paga: { label: "Paga", tone: "success", icon: Check },
} as const;

function CardForm({
  card,
  accounts,
  onDone,
}: {
  card: CardView | null;
  accounts: Data["accounts"];
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(saveCard, initial);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={card?.id ?? ""} />
      <Field label="Nome do cartão">
        <Input
          name="name"
          required
          maxLength={80}
          placeholder="Ex.: Cartão do banco"
          defaultValue={card?.name}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Dia do fechamento" hint="Último dia de compras da fatura.">
          <Input
            name="closingDay"
            type="number"
            min={1}
            max={31}
            required
            defaultValue={card?.closingDay}
          />
        </Field>
        <Field label="Dia do vencimento" hint="Quando a fatura deve ser paga.">
          <Input
            name="dueDay"
            type="number"
            min={1}
            max={31}
            required
            defaultValue={card?.dueDay}
          />
        </Field>
      </div>
      <Field label="Limite (R$)" hint="Opcional. Mostra quanto ainda está disponível.">
        <Input
          name="limit"
          inputMode="decimal"
          placeholder="0,00"
          defaultValue={card?.limitAmount?.replace(".", ",")}
        />
      </Field>
      <Field label="Conta que paga a fatura">
        <Select name="payingAccountId" required defaultValue={card?.payingAccountId}>
          {accounts
            .filter((a) => !a.archived || a.id === card?.payingAccountId)
            .map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
        </Select>
      </Field>
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando…" : "Salvar cartão"}
      </Button>
    </form>
  );
}

function CardTile({ card, selected }: { card: CardView; selected: boolean }) {
  return (
    <Link
      href={`/app/cartoes?c=${card.id}`}
      aria-current={selected ? "true" : undefined}
      className={cx(
        "flex h-full flex-col gap-3 rounded-2xl border bg-card p-5 shadow-card transition hover:border-brand-500",
        selected ? "border-brand-500 ring-1 ring-brand-500" : "border-line",
      )}
    >
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <CreditCard className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold">{card.name}</p>
          <p className="text-xs text-muted">
            Fecha dia {card.closingDay} · vence dia {card.dueDay}
          </p>
        </div>
      </div>
      <div>
        <p className="text-xs text-muted">Fatura atual</p>
        <p className="text-2xl font-semibold tabular-nums tracking-tight">
          {formatBRL(card.openTotal)}
        </p>
      </div>
      {card.limitAmount && card.available ? (
        <div>
          <div aria-hidden="true" className="h-2 rounded-full bg-brand-50">
            <div
              className="h-full rounded-full bg-brand-500"
              style={{ width: `${Math.min(100, percentOf(card.used, card.limitAmount))}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-muted">Disponível: {formatBRL(card.available)}</p>
        </div>
      ) : null}
    </Link>
  );
}

function Statement({
  card,
  month,
  today,
  accountName,
  writable,
  onEdit,
}: {
  card: CardView;
  month: string;
  today: string;
  accountName: string;
  writable: boolean;
  onEdit: () => void;
}) {
  const { openNew } = useEntryDialog();
  const [removing, setRemoving] = useState<Line | null>(null);
  const lines = card.lines
    .filter((line) => line.statementMonth === month)
    .sort((a, b) => a.purchasedOn.localeCompare(b.purchasedOn));
  const total = linesTotal(lines);
  const paid = card.paidMonths.includes(month);
  const status = STATUS[statementStatus(month, card, today, paid)];
  const StatusIcon = status.icon;
  const monthLink = (target: string) => `/app/cartoes?c=${card.id}&m=${target}`;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold first-letter:uppercase">
              {formatYearMonth(month)}
            </h2>
            <Badge tone={status.tone}>
              <StatusIcon className="size-3" aria-hidden="true" />
              {status.label}
            </Badge>
          </div>
          <p className="mt-0.5 text-sm text-muted">Fatura do {card.name}</p>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href={monthLink(addMonths(month, -1))}
            aria-label="Fatura anterior"
            className={buttonClass("secondary", true)}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Link>
          <Link
            href={monthLink(addMonths(month, 1))}
            aria-label="Próxima fatura"
            className={buttonClass("secondary", true)}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
          {writable ? (
            <>
              <IconButton label={`Editar ${card.name}`} onClick={onEdit}>
                <Pencil className="size-4" aria-hidden="true" />
              </IconButton>
              <form action={setCardArchived}>
                <input type="hidden" name="id" value={card.id} />
                <input type="hidden" name="archived" value="true" />
                <IconButton type="submit" label={`Arquivar ${card.name}`}>
                  <Archive className="size-4" aria-hidden="true" />
                </IconButton>
              </form>
            </>
          ) : null}
        </div>
      </div>

      <dl className="m-0 mt-4 grid grid-cols-3 gap-3 rounded-xl bg-card-soft p-4 text-sm">
        <div>
          <dt className="text-xs text-muted">Total</dt>
          <dd className="m-0 font-semibold tabular-nums">{formatBRL(total)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Fecha em</dt>
          <dd className="m-0 font-semibold tabular-nums">
            {formatShortDate(statementClosingDate(month, card))}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Vence em</dt>
          <dd className="m-0 font-semibold tabular-nums">
            {formatShortDate(statementDueDate(month, card))}
          </dd>
        </div>
      </dl>

      {writable ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => openNew("despesa", card.id)}>
            <Plus className="size-4" aria-hidden="true" />
            Nova compra
          </Button>
          {!paid && lines.length > 0 ? (
            <form action={confirmEntry}>
              <input type="hidden" name="key" value={`f:${card.id}:${month}`} />
              <Button type="submit">Pagar fatura</Button>
            </form>
          ) : null}
          {!paid && lines.length > 0 ? (
            <span className="text-xs text-muted">Sai de {accountName}</span>
          ) : null}
        </div>
      ) : null}

      {lines.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="Nenhuma compra nesta fatura"
            text="Compras parceladas aparecem em cada fatura até a última parcela."
          />
        </div>
      ) : (
        <div className="relative -mx-5 mt-4 sm:-mx-6">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Compras da fatura</caption>
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
                <th scope="col" className="py-2 pl-3 pr-5 text-right font-medium sm:pr-3">
                  Valor
                </th>
                {writable ? (
                  <th scope="col" className="hidden py-2 pr-6 sm:table-cell">
                    <span className="sr-only">Ações</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const remove =
                  writable && !line.locked ? (
                    <IconButton
                      label={`Excluir ${line.description}`}
                      onClick={() => setRemoving(line)}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </IconButton>
                  ) : null;
                return (
                  <tr key={line.purchaseId} className="border-b border-line last:border-0">
                    <td className="py-3 pl-5 pr-3 align-top tabular-nums text-muted sm:pl-6">
                      {formatShortDate(line.purchasedOn)}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <p className="font-medium">{line.description}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {line.installments > 1
                          ? `Parcela ${line.installment} de ${line.installments}`
                          : "À vista"}
                        <span className="md:hidden"> · {line.categoryName}</span>
                      </p>
                      {remove ? <div className="mt-1 sm:hidden">{remove}</div> : null}
                    </td>
                    <td className="hidden px-3 py-3 align-top text-muted md:table-cell">
                      {line.categoryName}
                    </td>
                    <td className="whitespace-nowrap py-3 pl-3 pr-5 text-right align-top font-semibold tabular-nums sm:pr-3">
                      {formatBRL(line.amount)}
                    </td>
                    {writable ? (
                      <td className="hidden py-2 pr-6 text-right align-top sm:table-cell">
                        {remove}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Excluir compra"
        text={`"${removing?.description ?? ""}" e todas as parcelas serão apagadas. Isso não pode ser desfeito.`}
        confirmLabel="Excluir"
        action={deletePurchase}
        hidden={{ id: removing?.purchaseId ?? "" }}
      />
    </Card>
  );
}

export function CardsBoard({
  data,
  selectedId,
  month,
  writable,
}: {
  data: Data;
  selectedId: string | null;
  month: string | null;
  writable: boolean;
}) {
  const [editing, setEditing] = useState<{ nonce: number; card: CardView | null } | null>(null);
  const active = data.cards.filter((card) => !card.archived);
  const archived = data.cards.filter((card) => card.archived);
  const selected = active.find((card) => card.id === selectedId) ?? active[0];
  const close = () => setEditing(null);
  const open = (card: CardView | null) => setEditing((s) => ({ nonce: (s?.nonce ?? 0) + 1, card }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Cartões"
        title="Cartões de crédito"
        description="Compras entram na fatura certa, e a fatura entra no mês em que vence."
        actions={
          writable ? (
            <Button variant="secondary" onClick={() => open(null)}>
              <Plus className="size-4" aria-hidden="true" />
              Novo cartão
            </Button>
          ) : null
        }
      />

      {active.length === 0 ? (
        <Card>
          <EmptyState
            title="Nenhum cartão cadastrado"
            text="Cadastre o cartão com os dias de fechamento e vencimento. As faturas se montam sozinhas a partir das compras."
            action={writable ? <Button onClick={() => open(null)}>Cadastrar cartão</Button> : null}
          />
        </Card>
      ) : (
        <>
          <ul
            aria-label="Cartões"
            className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
          >
            {active.map((card) => (
              <li key={card.id}>
                <CardTile card={card} selected={card.id === selected?.id} />
              </li>
            ))}
          </ul>
          {selected ? (
            <Statement
              card={selected}
              month={month ?? selected.openMonth}
              today={data.today}
              accountName={
                data.accounts.find((a) => a.id === selected.payingAccountId)?.name ?? "a conta"
              }
              writable={writable}
              onEdit={() => open(selected)}
            />
          ) : null}
        </>
      )}

      {archived.length > 0 ? (
        <Card
          title="Arquivados"
          description="Fora do novo lançamento. Faturas em aberto seguem no mês."
        >
          <ul className="m-0 list-none divide-y divide-line p-0">
            {archived.map((card) => (
              <li key={card.id} className="flex items-center justify-between gap-3 py-2">
                <span className="truncate text-sm">{card.name}</span>
                {writable ? (
                  <form action={setCardArchived}>
                    <input type="hidden" name="id" value={card.id} />
                    <input type="hidden" name="archived" value="false" />
                    <IconButton type="submit" label={`Reativar ${card.name}`}>
                      <ArchiveRestore className="size-4" aria-hidden="true" />
                    </IconButton>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Sheet
        open={editing !== null}
        onClose={close}
        title={editing?.card ? "Editar cartão" : "Novo cartão"}
      >
        <CardForm
          key={editing?.nonce}
          card={editing?.card ?? null}
          accounts={data.accounts}
          onDone={close}
        />
      </Sheet>
    </div>
  );
}
