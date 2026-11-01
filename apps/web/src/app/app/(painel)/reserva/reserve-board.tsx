"use client";
import { ArrowRight, ChevronDown, ShieldCheck } from "lucide-react";
import Link from "next/link";
import {
  useActionState,
  useEffect,
  useMemo,
  useOptimistic,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import {
  addMonths,
  formatBRL,
  formatYearMonth,
  money,
  monthsToReserve,
  parseBRL,
  reserveStatus,
} from "@organizeup/domain";
import { FxNote } from "@/components/fx-note";
import { buttonClass, cx } from "@/components/styles";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  FormMessage,
  Input,
  PageHeader,
  Sheet,
  submitKeeping,
} from "@/components/ui";
import type { loadReserve } from "@/lib/wealth";
import {
  saveReserveContribution,
  saveReserveEssential,
  saveReserveMonths,
  toggleReserveAccount,
  type ReserveFormState,
} from "./actions";
import { reserveNextStep, type NextStep } from "./next-step";

type Data = Awaited<ReturnType<typeof loadReserve>>;
type Status = Data["status"];

const initial: ReserveFormState = { ok: false, message: null };

const months = (value: number) =>
  `${value.toLocaleString("pt-BR")} ${value === 1 ? "mês" : "meses"}`;

const toInput = (value: string | null) => value?.replace(".", ",") ?? "";

function basisText(data: Data) {
  const { basis, months: used } = data.baseline;
  if (basis === "informado") return "Você informou esse valor.";
  if (basis === "media")
    return used === 1
      ? "Vem dos seus gastos do último mês fechado."
      : `Vem da média dos seus gastos nos últimos ${used} meses.`;
  return "É uma estimativa pelo mês atual, com o que está previsto.";
}

/** Número de meses digitado, ou null enquanto não for um valor aceito. */
function parseMonths(text: string) {
  const value = Number(text);
  return Number.isInteger(value) && value >= 1 && value <= 60 ? value : null;
}

/** Valor digitado em banco ("500.00"), null em branco e "invalid" se não der para ler. */
function parseAmount(text: string) {
  if (!text.trim()) return null;
  try {
    const value = parseBRL(text);
    return value.lte(0) ? "invalid" : value.toFixed(2);
  } catch {
    return "invalid";
  }
}

function EssentialForm({ data, onDone }: { data: Data; onDone: () => void }) {
  const [state, action, pending] = useActionState(saveReserveEssential, initial);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        É o que sua família precisa para viver um mês: moradia, mercado, contas e transporte.
      </p>
      <Field
        label="Gasto essencial por mês (R$)"
        hint="Opcional. Em branco, calculamos pelos lançamentos em categorias essenciais."
      >
        <Input
          name="monthly"
          inputMode="decimal"
          placeholder="0,00"
          defaultValue={toInput(data.informedMonthly)}
        />
      </Field>
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando…" : "Salvar gasto essencial"}
      </Button>
    </form>
  );
}

function SaveInline({ pending, label }: { pending: boolean; label: string }) {
  return (
    <Button type="submit" variant="secondary" disabled={pending} aria-label={label}>
      {pending ? "Salvando…" : "Salvar"}
    </Button>
  );
}

function MonthsField({
  saved,
  text,
  onChange,
  writable,
}: {
  saved: number;
  text: string;
  onChange: (text: string) => void;
  writable: boolean;
}) {
  const [state, action, pending] = useActionState(saveReserveMonths, initial);
  const typed = parseMonths(text);
  const dirty = typed !== null && typed !== saved;
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-wrap items-end gap-2">
      <div className="w-36">
        <Field
          label="Meses de reserva"
          hint="De 1 a 60."
          error={typed === null ? "Informe de 1 a 60 meses." : undefined}
        >
          <Input
            name="targetMonths"
            type="number"
            inputMode="numeric"
            min={1}
            max={60}
            required
            disabled={!writable}
            value={text}
            onChange={(event) => onChange(event.target.value)}
          />
        </Field>
      </div>
      {writable && dirty ? (
        <div className="pb-5">
          <SaveInline pending={pending} label="Salvar meses de reserva" />
        </div>
      ) : null}
      <div className="w-full">
        <FormMessage message={state.ok ? null : state.message} />
      </div>
    </form>
  );
}

function AccountToggle({
  account,
  writable,
}: {
  account: Data["accounts"][number];
  writable: boolean;
}) {
  const [selected, setSelected] = useOptimistic(account.selected);
  const [, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = (next: boolean) => {
    setError(null);
    start(async () => {
      setSelected(next);
      const result = await toggleReserveAccount(account.id, next);
      if (!result.ok) setError(result.message);
    });
  };

  return (
    <li className="py-1">
      <label
        className={cx(
          "flex min-h-11 items-center gap-3 rounded-xl px-2 py-1.5 text-sm",
          writable && "cursor-pointer hover:bg-brand-50",
        )}
      >
        <input
          type="checkbox"
          checked={selected}
          disabled={!writable}
          onChange={(event) => toggle(event.target.checked)}
          className="size-5 shrink-0 accent-brand-500"
        />
        <span className={cx("min-w-0 flex-1 break-words", selected && "font-medium")}>
          {account.name}
        </span>
        <span className="tabular-nums text-muted">{formatBRL(account.balance)}</span>
      </label>
      <FormMessage message={error} />
    </li>
  );
}

function NeedCard({
  data,
  status,
  monthsText,
  onMonths,
  writable,
  onEdit,
}: {
  data: Data;
  status: Status;
  monthsText: string;
  onMonths: (text: string) => void;
  writable: boolean;
  onEdit: () => void;
}) {
  if (data.baseline.basis === "sem_dados")
    return (
      <Card title="Quanto preciso guardar">
        <p className="font-semibold">Falta saber seu gasto essencial</p>
        <p className="mt-1 text-sm text-muted">
          O valor da reserva depende de quanto sua família gasta por mês com o que não dá para
          cortar. Com esse número, calculamos o resto.
        </p>
        {writable ? (
          <Button variant="secondary" className="mt-4" onClick={onEdit}>
            Informar gasto essencial
          </Button>
        ) : null}
      </Card>
    );

  const used = parseMonths(monthsText) ?? data.targetMonths;
  return (
    <Card title="Quanto preciso guardar">
      <p className="font-display text-4xl font-medium tabular-nums">{formatBRL(status.target)}</p>
      <p className="mt-2 text-sm">
        {months(used)} dos seus gastos essenciais, de {formatBRL(data.baseline.monthly)} por mês.
      </p>
      <p className="mt-1 text-sm text-muted">{basisText(data)}</p>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <MonthsField
          saved={data.targetMonths}
          text={monthsText}
          onChange={onMonths}
          writable={writable}
        />
        {writable ? (
          <Button variant="ghost" onClick={onEdit}>
            Ajustar gasto essencial
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function HaveCard({ data, status, writable }: { data: Data; status: Status; writable: boolean }) {
  const selected = data.accounts.filter((account) => account.selected);
  return (
    <Card title="Quanto já tenho">
      <p className="font-display text-4xl font-medium tabular-nums">{formatBRL(status.saved)}</p>
      <FxNote fx={data.fx} className="m-0 mt-1 text-xs text-muted" />
      <p className="mt-2 text-sm">
        {selected.length === 0
          ? "Nenhuma conta marcada ainda."
          : selected.length === 1
            ? `Guardado em ${selected[0]!.name}.`
            : `Guardado em ${selected.length} contas.`}
      </p>
      <p className="mt-1 text-sm text-muted">
        A reserva é o saldo das contas marcadas abaixo. A conta entra inteira, então prefira uma
        conta só para isso.
      </p>
      {data.accounts.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="Você ainda não tem conta cadastrada"
            text="Cadastre a conta onde guarda esse dinheiro para ela aparecer aqui."
            action={
              writable ? (
                <Link href="/app/contas" className={buttonClass("secondary")}>
                  Cadastrar conta
                </Link>
              ) : null
            }
          />
        </div>
      ) : (
        <ul
          aria-label="Contas da reserva"
          className="m-0 mt-3 list-none divide-y divide-line border-y border-line p-0"
        >
          {data.accounts.map((account) => (
            <AccountToggle key={account.id} account={account} writable={writable} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ContributionForm({
  data,
  text,
  onChange,
  suggested,
  writable,
}: {
  data: Data;
  text: string;
  onChange: (text: string) => void;
  suggested: string | null;
  writable: boolean;
}) {
  const [state, action, pending] = useActionState(saveReserveContribution, initial);
  const typed = parseAmount(text);
  const saved = data.contribution === null ? null : money(data.contribution).toFixed(2);
  const dirty = typed !== "invalid" && typed !== saved;
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-wrap items-end gap-2">
      <div className="w-72 max-w-full">
        <Field
          label="Quanto consigo guardar por mês (R$)"
          hint={
            suggested && !saved ? `Seu plano sugere ${formatBRL(suggested)} por mês.` : undefined
          }
          error={typed === "invalid" ? "Informe um valor como 500,00." : undefined}
        >
          <Input
            name="contribution"
            inputMode="decimal"
            placeholder="0,00"
            value={text}
            onChange={(event) => onChange(event.target.value)}
          />
        </Field>
      </div>
      {writable && dirty ? (
        <div className={suggested && !saved ? "pb-5" : undefined}>
          <SaveInline pending={pending} label="Salvar quanto guardar por mês" />
        </div>
      ) : null}
      <div className="w-full">
        <FormMessage message={state.ok ? null : state.message} />
      </div>
    </form>
  );
}

function MissingCard({
  data,
  status,
  done,
  percent,
  amount,
  contributionText,
  onContribution,
  suggested,
  writable,
}: {
  data: Data;
  status: Status;
  done: boolean;
  percent: number;
  amount: string | null;
  contributionText: string;
  onContribution: (text: string) => void;
  suggested: string | null;
  writable: boolean;
}) {
  if (data.baseline.basis === "sem_dados")
    return (
      <Card title="Quanto falta">
        <p className="text-sm text-muted">
          Assim que soubermos seu gasto essencial, mostramos quanto falta e em quanto tempo você
          chega lá.
        </p>
      </Card>
    );

  const left = amount === null ? null : monthsToReserve(status.missing, amount);
  return (
    <Card title="Quanto falta">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="font-display text-4xl font-medium tabular-nums">
          {formatBRL(status.missing)}
        </p>
        {done ? (
          <Badge tone="success">
            <ShieldCheck className="size-3" aria-hidden="true" />
            Reserva completa
          </Badge>
        ) : null}
      </div>
      <div
        role="progressbar"
        aria-label="Progresso da reserva"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-4 h-3 rounded-full bg-brand-100"
      >
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-2 text-sm text-muted">
        {percent}% do alvo · cobre {months(status.coveredMonths)} de gastos essenciais
      </p>
      {done ? null : (
        <div className="mt-5 border-t border-line pt-4">
          <ContributionForm
            data={data}
            text={contributionText}
            onChange={onContribution}
            suggested={suggested}
            writable={writable}
          />
          {left !== null && amount !== null ? (
            <p role="status" className="mt-3 text-sm">
              Guardando <span className="font-semibold">{formatBRL(amount)}</span> por mês, você
              chega em{" "}
              <span className="font-semibold">{formatYearMonth(addMonths(data.month, left))}</span>,
              daqui a {months(left)}.
            </p>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function NextStepCard({ step, writable }: { step: NextStep; writable: boolean }) {
  const { action } = step;
  const className = cx(buttonClass("accent"), "shrink-0");
  const content = (
    <>
      {action.label}
      <ArrowRight className="size-4" aria-hidden="true" />
    </>
  );
  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-brand-900 p-5 text-white shadow-card sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div className="min-w-0">
        <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-sand-200">
          Próximo passo
        </h2>
        <p className="mt-1 font-display text-2xl font-medium">{step.title}</p>
        <p className="mt-1 max-w-2xl text-sm text-sand-100">{step.text}</p>
      </div>
      {!action.writes || writable ? (
        action.href.startsWith("#") ? (
          <a href={action.href} className={className}>
            {content}
          </a>
        ) : (
          <Link href={action.href} className={className}>
            {content}
          </Link>
        )
      ) : null}
    </section>
  );
}

function HowItWorks() {
  return (
    <details className="group rounded-2xl border border-line bg-card shadow-card">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-5 font-semibold sm:px-6 [&::-webkit-details-marker]:hidden">
        <span>Como funciona</span>
        <ChevronDown
          className="size-5 shrink-0 text-muted transition group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="flex flex-col gap-3 px-5 pb-5 text-sm sm:px-6 sm:pb-6">
        <p>
          <span className="font-semibold">De onde vêm os gastos essenciais.</span> Somamos tudo que
          você lançou em categorias marcadas como essenciais, inclusive compras no cartão e parcelas
          de dívida. Usamos a média dos últimos 3 meses fechados. Quem acabou de começar vê uma
          estimativa pelo mês atual, e você pode informar o valor se preferir.
        </p>
        <p>
          <span className="font-semibold">Como marcar uma categoria como essencial.</span> Em{" "}
          <Link href="/app/categorias" className="font-medium underline">
            Categorias
          </Link>
          , edite a categoria e marque “É um gasto essencial”. A partir daí, os gastos dessa
          categoria entram no cálculo.
        </p>
        <p>
          <span className="font-semibold">Como o dinheiro entra na reserva.</span> A reserva não é
          uma conta nova: ela soma o saldo das contas que você marca aqui. Se o saldo sobe ou desce,
          a reserva acompanha.
        </p>
      </div>
    </details>
  );
}

export function ReserveBoard({
  data,
  suggested,
  writable,
  insights,
}: {
  data: Data;
  suggested: string | null;
  writable: boolean;
  insights: ReactNode;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const close = () => setEditing(null);
  const open = () => setEditing((nonce) => (nonce ?? 0) + 1);

  const [monthsText, setMonthsText] = useState(String(data.targetMonths));
  const [contributionText, setContributionText] = useState(toInput(data.contribution));

  // O alvo acompanha o número digitado antes de salvar.
  const status = useMemo(
    () =>
      reserveStatus(
        data.status.saved,
        data.baseline.monthly,
        parseMonths(monthsText) ?? data.targetMonths,
      ),
    [data.status.saved, data.baseline.monthly, data.targetMonths, monthsText],
  );

  const typed = parseAmount(contributionText);
  const amount = typed === "invalid" ? null : (typed ?? suggested);
  const hasBaseline = data.baseline.basis !== "sem_dados";
  const done = hasBaseline && money(status.missing).isZero();
  // Arredondar não pode mostrar 100% enquanto ainda falta dinheiro.
  const percent = done ? 100 : Math.min(status.percent, 99);
  const step = reserveNextStep({
    hasBaseline,
    hasExpenses: data.hasExpenses,
    accounts: data.accounts,
    status,
    contribution: amount,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Reserva"
        title="Reserva de emergência"
        description="Dinheiro guardado para imprevistos, como perda de renda ou conserto, sem precisar se endividar."
      />
      {insights}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <NeedCard
          data={data}
          status={status}
          monthsText={monthsText}
          onMonths={setMonthsText}
          writable={writable}
          onEdit={open}
        />
        <div id="quanto-tenho" className="scroll-mt-6">
          <HaveCard data={data} status={status} writable={writable} />
        </div>
      </div>

      <div id="quanto-falta" className="scroll-mt-6">
        <MissingCard
          data={data}
          status={status}
          done={done}
          percent={percent}
          amount={amount}
          contributionText={contributionText}
          onContribution={setContributionText}
          suggested={suggested}
          writable={writable}
        />
      </div>

      <NextStepCard step={step} writable={writable} />
      <HowItWorks />

      <Sheet open={editing !== null} onClose={close} title="Gasto essencial">
        <EssentialForm key={editing} data={data} onDone={close} />
      </Sheet>
    </div>
  );
}
