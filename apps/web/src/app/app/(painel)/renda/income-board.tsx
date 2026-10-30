"use client";
import { AlertTriangle, Info, Pencil, Plus, Trash2 } from "lucide-react";
import { useActionState, useEffect, useMemo, useState } from "react";
import {
  calculatePayslip,
  calculateThirteenth,
  calculateVacation,
  formatBRL,
  formatYearMonth,
  money,
  parseBRL,
  toDbAmount,
  type IncomeKind,
  type Payslip,
  type ThirteenthSalary,
  type VacationPay,
} from "@organizeup/domain";
import { cx } from "@/components/styles";
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
  StatTile,
} from "@/components/ui";
import type { loadIncome } from "@/lib/income-data";
import { saveIncome, stopIncome, type IncomeFormState } from "./actions";

type Data = Awaited<ReturnType<typeof loadIncome>>;
type Source = Data["sources"][number];

const KIND_LABEL: Record<IncomeKind, string> = {
  clt: "Salário CLT",
  pj_autonomo: "PJ ou autônomo",
  aposentadoria_pensao: "Aposentadoria ou pensão",
  aluguel: "Aluguel recebido",
  outro: "Outra renda",
};

const MONTHS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

/** Categoria padrão de cada tipo de renda. */
const DEFAULT_CATEGORY: Record<IncomeKind, string> = {
  clt: "Salário",
  pj_autonomo: "Trabalho autônomo",
  aposentadoria_pensao: "Outras receitas",
  aluguel: "Aluguel recebido",
  outro: "Outras receitas",
};

const initial: IncomeFormState = { ok: false, message: null };
const comma = (value: string) => value.replace(".", ",");
const hasValue = (value: string) => !money(value).isZero();

interface Draft {
  gross: string;
  dependents: string;
  pension: string;
  otherDiscounts: string;
}

function Line({
  label,
  value,
  negative,
  strong,
}: {
  label: string;
  value: string;
  negative?: boolean;
  strong?: boolean;
}) {
  return (
    <div
      className={cx(
        "flex justify-between gap-3 py-1.5 text-sm",
        strong && "border-t border-line font-semibold",
      )}
    >
      <dt className={strong ? "" : "text-muted"}>{label}</dt>
      <dd className="m-0 whitespace-nowrap font-medium tabular-nums">
        {negative ? "− " : ""}
        {formatBRL(value)}
      </dd>
    </div>
  );
}

function PayslipLines({ slip }: { slip: Payslip }) {
  return (
    <dl className="m-0">
      <Line label="Salário bruto" value={slip.gross} />
      <Line label="INSS" value={slip.inss} negative />
      <Line label="Imposto de renda" value={slip.tax} negative />
      {hasValue(slip.pension) ? <Line label="Pensão" value={slip.pension} negative /> : null}
      {hasValue(slip.otherDiscounts) ? (
        <Line label="Outros descontos" value={slip.otherDiscounts} negative />
      ) : null}
      <Line label="Líquido estimado" value={slip.net} strong />
    </dl>
  );
}

function taxNote(slip: Payslip) {
  const deduction =
    slip.deduction === "simplificado"
      ? "Usamos o desconto simplificado, que foi melhor neste caso."
      : "Usamos as deduções legais, que foram melhores neste caso.";
  if (!hasValue(slip.reduction)) return deduction;
  return `${deduction} A redução da lei tirou ${formatBRL(slip.reduction)} do imposto.`;
}

function ExtraPay({
  thirteenth,
  vacation,
}: {
  thirteenth: ThirteenthSalary;
  vacation: VacationPay;
}) {
  const uncertain = !money(vacation.net).equals(vacation.netWithReduction);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <section aria-label="13º salário" className="rounded-xl bg-card-soft p-4">
        <h3 className="text-sm font-semibold">13º salário</h3>
        <dl className="m-0 mt-1">
          <Line label="1ª parcela, novembro" value={thirteenth.firstInstallment} />
          <Line label="2ª parcela, dezembro" value={thirteenth.secondInstallment} />
          <Line label="Total líquido" value={thirteenth.net} strong />
        </dl>
      </section>
      <section aria-label="Férias" className="rounded-xl bg-card-soft p-4">
        <h3 className="text-sm font-semibold">Férias de 30 dias</h3>
        <dl className="m-0 mt-1">
          <Line label="Salário + 1/3" value={vacation.gross} />
          <Line label="Líquido estimado" value={vacation.net} strong />
        </dl>
        {uncertain ? (
          <p className="mt-2 text-xs text-muted">
            Pode vir até {formatBRL(vacation.netWithReduction)}. A Receita ainda não explicou se a
            redução vale para férias, então prevemos o valor menor.
          </p>
        ) : null}
      </section>
    </div>
  );
}

function Simulator({
  data,
  writable,
  onRegister,
}: {
  data: Data;
  writable: boolean;
  onRegister: (draft: Draft) => void;
}) {
  const [draft, setDraft] = useState<Draft>({
    gross: "",
    dependents: "0",
    pension: "",
    otherDiscounts: "",
  });
  const set = (field: keyof Draft) => (event: { target: { value: string } }) =>
    setDraft((current) => ({ ...current, [field]: event.target.value }));

  const result = useMemo(() => {
    const read = (text: string) => {
      if (!text.trim()) return "0.00";
      const value = parseBRL(text);
      if (value.lt(0)) throw new RangeError("negativo");
      return toDbAmount(value);
    };
    try {
      const gross = read(draft.gross);
      const dependents = Number(draft.dependents || "0");
      if (!Number.isInteger(dependents) || dependents < 0 || dependents > 20) return "invalid";
      if (money(gross).isZero()) return null;
      const input = {
        gross,
        dependents,
        pension: read(draft.pension),
        otherDiscounts: read(draft.otherDiscounts),
      };
      return {
        slip: calculatePayslip(input, data.table),
        thirteenth: calculateThirteenth(input, data.table),
        vacation: calculateVacation(input, data.table),
      };
    } catch {
      return "invalid";
    }
  }, [draft, data.table]);

  return (
    <Card
      title="Simulador de salário"
      description="Veja quanto de um salário CLT sobra depois dos descontos."
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid grid-cols-2 content-start gap-3">
          <Field
            label="Salário bruto (R$)"
            error={result === "invalid" ? "Confira os valores, como 4.500,00." : undefined}
          >
            <Input
              inputMode="decimal"
              placeholder="0,00"
              value={draft.gross}
              onChange={set("gross")}
            />
          </Field>
          <Field label="Dependentes">
            <Input
              type="number"
              min={0}
              max={20}
              value={draft.dependents}
              onChange={set("dependents")}
            />
          </Field>
          <Field label="Pensão (R$)" hint="Alimentícia, por decisão judicial ou acordo.">
            <Input
              inputMode="decimal"
              placeholder="0,00"
              value={draft.pension}
              onChange={set("pension")}
            />
          </Field>
          <Field label="Outros descontos (R$)" hint="Plano de saúde, vale e outros.">
            <Input
              inputMode="decimal"
              placeholder="0,00"
              value={draft.otherDiscounts}
              onChange={set("otherDiscounts")}
            />
          </Field>
        </div>
        <div className="min-w-0">
          {result && result !== "invalid" ? (
            <>
              <PayslipLines slip={result.slip} />
              <p className="mt-2 text-xs text-muted">{taxNote(result.slip)}</p>
            </>
          ) : (
            <p className="rounded-xl bg-card-soft p-4 text-sm text-muted">
              Digite o salário bruto para ver o resultado.
            </p>
          )}
        </div>
      </div>
      {result && result !== "invalid" ? (
        <div className="mt-4 flex flex-col gap-4">
          <ExtraPay thirteenth={result.thirteenth} vacation={result.vacation} />
          {writable ? (
            <div>
              <Button variant="secondary" onClick={() => onRegister(draft)}>
                <Plus className="size-4" aria-hidden="true" />
                Cadastrar esta renda
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function IncomeForm({
  source,
  draft,
  data,
  onDone,
}: {
  source: Source | null;
  draft: Draft | null;
  data: Data;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(saveIncome, initial);
  const [kind, setKind] = useState<IncomeKind>(source?.kind ?? "clt");
  const clt = kind === "clt";
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  const errors = state.fieldErrors ?? {};
  const defaultCategory = data.categories.find((c) => c.name === DEFAULT_CATEGORY[kind])?.id;

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={source?.id ?? ""} />
      <Field label="Tipo de renda" error={errors.kind}>
        <Select
          name="kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as IncomeKind)}
        >
          {Object.entries(KIND_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={clt ? "Empresa" : "De onde vem"} error={errors.name}>
        <Input
          name="name"
          required
          maxLength={80}
          placeholder={clt ? "Ex.: Empresa Exemplo" : "Ex.: Aluguel da sala"}
          defaultValue={source?.name}
        />
      </Field>
      <div className="grid grid-cols-[3fr_2fr] gap-3">
        <Field
          label={clt ? "Salário bruto (R$)" : "Valor que cai na conta (R$)"}
          error={errors.amount}
        >
          <Input
            name="amount"
            inputMode="decimal"
            required
            placeholder="0,00"
            defaultValue={source ? comma(source.amount) : draft?.gross}
          />
        </Field>
        <Field label="Dia do pagamento" error={errors.payDay}>
          <Input
            name="payDay"
            type="number"
            min={1}
            max={31}
            required
            defaultValue={source?.payDay ?? 5}
          />
        </Field>
      </div>
      {clt ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Dependentes" error={errors.dependents}>
              <Input
                name="dependents"
                type="number"
                min={0}
                max={20}
                defaultValue={source?.dependents ?? (draft?.dependents || 0)}
              />
            </Field>
            <Field label="Mês das férias" error={errors.vacationMonth}>
              <Select name="vacationMonth" defaultValue={source?.vacationMonth ?? 0}>
                <option value={0}>Ainda não sei</option>
                {MONTHS.map((month, index) => (
                  <option key={month} value={index + 1}>
                    {month}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Pensão (R$)" error={errors.pensionAmount}>
              <Input
                name="pensionAmount"
                inputMode="decimal"
                placeholder="0,00"
                defaultValue={source ? comma(source.pensionAmount) : draft?.pension}
              />
            </Field>
            <Field label="Outros descontos (R$)" error={errors.otherDiscounts}>
              <Input
                name="otherDiscounts"
                inputMode="decimal"
                placeholder="0,00"
                defaultValue={source ? comma(source.otherDiscounts) : draft?.otherDiscounts}
              />
            </Field>
          </div>
        </>
      ) : null}
      <Field label="Conta que recebe" error={errors.accountId}>
        <Select name="accountId" required defaultValue={source?.accountId}>
          {data.accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Categoria" error={errors.categoryId}>
          <Select
            key={kind}
            name="categoryId"
            required
            defaultValue={source?.categoryId ?? defaultCategory}
          >
            {data.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="De quem é" error={errors.personId}>
          <Select name="personId" defaultValue={source?.personId ?? ""}>
            <option value="">Da família</option>
            {data.people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {source?.hasReceipts ? (
        <p className="rounded-xl bg-brand-50 p-3 text-sm text-muted">
          O que você já recebeu não muda. A alteração vale para as próximas previsões.
        </p>
      ) : null}
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando…" : "Salvar renda"}
      </Button>
    </form>
  );
}

function SourceCard({
  source,
  data,
  writable,
  onEdit,
  onStop,
}: {
  source: Source;
  data: Data;
  writable: boolean;
  onEdit: () => void;
  onStop: () => void;
}) {
  const person = data.people.find((p) => p.id === source.personId)?.name;
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">{source.name}</h2>
          <p className="text-xs text-muted">
            {KIND_LABEL[source.kind]}
            {person ? ` · ${person}` : ""} · todo dia {source.payDay}
          </p>
        </div>
        {writable ? (
          <div className="flex shrink-0">
            <IconButton label={`Editar ${source.name}`} onClick={onEdit}>
              <Pencil className="size-4" aria-hidden="true" />
            </IconButton>
            <IconButton
              label={`${source.hasReceipts ? "Encerrar" : "Excluir"} ${source.name}`}
              onClick={onStop}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </IconButton>
          </div>
        ) : null}
      </div>
      {source.payslip && source.thirteenth && source.vacation ? (
        <div className="mt-3 flex flex-col gap-3">
          <PayslipLines slip={source.payslip} />
          <p className="text-xs text-muted">{taxNote(source.payslip)}</p>
          <ExtraPay thirteenth={source.thirteenth} vacation={source.vacation} />
          {source.vacationMonth ? (
            <div>
              <Badge>Férias em {MONTHS[source.vacationMonth - 1]?.toLowerCase()}</Badge>
            </div>
          ) : (
            <p className="text-xs text-muted">
              Sem mês de férias definido: a previsão fica como salário normal o ano todo.
            </p>
          )}
        </div>
      ) : (
        <p className="mt-3 text-2xl font-semibold tabular-nums tracking-tight">
          {formatBRL(source.monthly)}
        </p>
      )}
    </Card>
  );
}

export function IncomeBoard({ data, writable }: { data: Data; writable: boolean }) {
  const [editing, setEditing] = useState<{
    nonce: number;
    source: Source | null;
    draft: Draft | null;
  } | null>(null);
  const [stopping, setStopping] = useState<Source | null>(null);
  const close = () => setEditing(null);
  const open = (source: Source | null, draft: Draft | null = null) =>
    setEditing((s) => ({ nonce: (s?.nonce ?? 0) + 1, source, draft }));
  const hasPayroll = data.sources.some((source) => source.payslip);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Renda"
        title="Quanto entra por mês"
        description="Cadastre sua renda uma vez. Ela aparece sozinha no mês, no calendário e nos vencimentos."
        actions={
          writable ? (
            <Button variant="secondary" onClick={() => open(null)}>
              <Plus className="size-4" aria-hidden="true" />
              Nova renda
            </Button>
          ) : null
        }
      />

      <div className="flex items-start gap-2 rounded-xl bg-card p-3 text-sm text-muted">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>
          É uma estimativa com as tabelas oficiais de {formatYearMonth(data.table.validFrom)}. O
          holerite real pode ser diferente: horas extras, faltas, benefícios e regras da empresa
          mudam o valor.
        </p>
      </div>

      {data.recurringIncome > 0 && data.sources.length > 0 ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl bg-warning-soft p-3 text-sm text-warning"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            Você também tem receita que repete todo mês em Lançamentos. Se for a mesma renda, pare
            de repetir por lá para não contar em dobro.
          </p>
        </div>
      ) : null}

      {data.sources.length > 0 ? (
        <dl className="m-0 grid grid-cols-2 gap-4 xl:grid-cols-4">
          <StatTile label="Líquido por mês" value={formatBRL(data.summary.monthly)} />
          <StatTile label="Bruto por mês" value={formatBRL(data.summary.gross)} />
          <StatTile label="Descontos por mês" value={formatBRL(data.summary.discounts)} />
          {hasPayroll ? (
            <StatTile label="13º líquido" value={formatBRL(data.summary.thirteenth)} />
          ) : null}
        </dl>
      ) : null}

      {data.sources.length === 0 ? (
        <Card>
          <EmptyState
            title="Nenhuma renda cadastrada"
            text="Cadastre salário, aposentadoria, aluguel ou outra entrada. Na CLT, calculamos INSS, imposto, 13º e férias."
            action={writable ? <Button onClick={() => open(null)}>Cadastrar renda</Button> : null}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
          {data.sources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              data={data}
              writable={writable}
              onEdit={() => open(source)}
              onStop={() => setStopping(source)}
            />
          ))}
        </div>
      )}

      <Simulator data={data} writable={writable} onRegister={(draft) => open(null, draft)} />

      <Sheet
        open={editing !== null}
        onClose={close}
        title={editing?.source ? "Editar renda" : "Nova renda"}
      >
        <IncomeForm
          key={editing?.nonce}
          source={editing?.source ?? null}
          draft={editing?.draft ?? null}
          data={data}
          onDone={close}
        />
      </Sheet>
      <ConfirmSheet
        open={stopping !== null}
        onClose={() => setStopping(null)}
        title={stopping?.hasReceipts ? "Encerrar renda" : "Excluir renda"}
        text={
          stopping?.hasReceipts
            ? `"${stopping?.name ?? ""}" para de aparecer a partir deste mês. O que você já recebeu continua nos lançamentos.`
            : `"${stopping?.name ?? ""}" e as previsões dela serão apagadas.`
        }
        confirmLabel={stopping?.hasReceipts ? "Encerrar" : "Excluir"}
        action={stopIncome}
        hidden={{ id: stopping?.id ?? "" }}
      />
    </div>
  );
}
