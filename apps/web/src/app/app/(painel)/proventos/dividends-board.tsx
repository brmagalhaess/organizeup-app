"use client";
import { Plus, Target, Trash2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { formatBRL, formatYearMonth, money, netDividend } from "@organizeup/domain";
import { buttonClass } from "@/components/styles";
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
  submitKeeping,
} from "@/components/ui";
import type { loadDividends } from "@/lib/investments";
import { addDividend, deleteDividend, saveGoal, type FormState } from "./actions";
import { DividendsChart } from "./dividends-chart";
import type { loadDividendOutlook } from "./outlook";

type Data = Awaited<ReturnType<typeof loadDividends>>;
type Row = Data["rows"][number];
type Outlook = NonNullable<Awaited<ReturnType<typeof loadDividendOutlook>>>;

const KIND_LABEL: Record<string, string> = {
  dividendo: "Dividendo",
  jcp: "JCP",
  rendimento: "Rendimento",
};

const initial: FormState = { ok: false, message: null };
const fullDate = (date: string) => date.split("-").reverse().join("/");

function DividendForm({ data, onDone }: { data: Data; onDone: () => void }) {
  const [state, action, pending] = useActionState(addDividend, initial);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <Field label="Investimento">
        <Select name="investmentId" required>
          {data.investments.map((investment) => (
            <option key={investment.id} value={investment.id}>
              {investment.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tipo">
          <Select name="kind" defaultValue="dividendo">
            {Object.entries(KIND_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Data do pagamento">
          <Input name="paidOn" type="date" required defaultValue={data.today} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor bruto (R$)">
          <Input name="gross" inputMode="decimal" required placeholder="0,00" />
        </Field>
        <Field label="Imposto retido (R$)" hint="Como aparece no extrato.">
          <Input name="withheld" inputMode="decimal" placeholder="0,00" />
        </Field>
      </div>
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando…" : "Salvar provento"}
      </Button>
    </form>
  );
}

function GoalForm({ data, onDone }: { data: Data; onDone: () => void }) {
  const [state, action, pending] = useActionState(saveGoal, initial);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <Field label="Meta de renda por mês (R$)" hint="Deixe vazio para tirar a meta.">
        <Input
          name="monthlyAmount"
          inputMode="decimal"
          placeholder="1.500,00"
          defaultValue={data.goal?.replace(".", ",") ?? ""}
        />
      </Field>
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando…" : "Salvar meta"}
      </Button>
    </form>
  );
}

const TARGET_BASIS: Record<Outlook["targetBasis"], string> = {
  informado: "Você informou este valor.",
  gasto_medio: "Igual ao seu gasto médio.",
  essencial_120: "Seu gasto essencial mais 20%.",
  sem_dados: "",
};

function yieldHint(outlook: Outlook) {
  switch (outlook.yieldBasis) {
    case "observado_12m":
      return "Pelos proventos dos últimos 12 meses.";
    case "observado_anualizado":
      return `Baseado em ${outlook.yieldMonthsBasis ?? 0} meses.`;
    case "informado":
      return "Informado por você.";
    case "suspeito":
      return "Os proventos registrados parecem fora do normal. Confira os valores.";
    default:
      return "Registre proventos para calcular.";
  }
}

function OutlookTiles({ outlook }: { outlook: Outlook }) {
  return (
    <dl className="m-0 grid grid-cols-2 gap-4 xl:grid-cols-3">
      <StatTile
        label="Rendimento anual da carteira"
        value={
          outlook.yieldUsed === null
            ? "Sem dados"
            : `${money(outlook.yieldUsed).toDecimalPlaces(1).toNumber().toLocaleString("pt-BR")}%`
        }
        hint={yieldHint(outlook)}
      />
      <StatTile
        label="Renda mensal atual"
        value={formatBRL(outlook.currentIncome)}
        hint="Proventos de 12 meses divididos por 12."
      />
      <StatTile
        label="Renda alvo"
        value={outlook.targetIncome ? formatBRL(outlook.targetIncome) : "Sem dados"}
        hint={
          outlook.targetIncome ? (
            `${TARGET_BASIS[outlook.targetBasis]} A carteira já cobre ${outlook.coverage}% do que falta.`
          ) : (
            <>
              Defina em{" "}
              <Link href="/app/aposentadoria" className="font-medium underline">
                Aposentadoria
              </Link>
              .
            </>
          )
        }
      />
    </dl>
  );
}

function ForecastCard({ months }: { months: Outlook["forecast"] }) {
  return (
    <Card
      title="Previsto por mês"
      description="Cada valor é uma previsão pelo histórico; não é garantia."
    >
      {months.length === 0 ? (
        <p className="text-sm text-muted">
          A previsão aparece quando houver proventos nos últimos 12 meses.
        </p>
      ) : (
        <table className="w-full text-sm">
          <caption className="sr-only">Proventos previstos por mês</caption>
          <thead>
            <tr className="text-left text-muted">
              <th scope="col" className="py-1.5 font-medium">
                Mês
              </th>
              <th scope="col" className="py-1.5 text-right font-medium">
                Previsto
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {months.map((row) => (
              <tr key={row.month}>
                <td className="py-1.5 first-letter:uppercase">{formatYearMonth(row.month)}</td>
                <td className="py-1.5 text-right font-medium tabular-nums">
                  {formatBRL(row.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function DividendsBoard({
  data,
  outlook,
  writable,
}: {
  data: Data;
  outlook: Outlook | null;
  writable: boolean;
}) {
  const [sheet, setSheet] = useState<{ type: "new" | "goal"; nonce: number } | null>(null);
  const [removing, setRemoving] = useState<Row | null>(null);
  const close = () => setSheet(null);
  const open = (type: "new" | "goal") => setSheet((s) => ({ type, nonce: (s?.nonce ?? 0) + 1 }));
  const { summary } = data;
  const canAdd = writable && data.investments.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Proventos"
        title={formatBRL(summary.last12)}
        description="Recebido nos últimos 12 meses, já sem o imposto."
        actions={
          canAdd ? (
            <Button variant="secondary" onClick={() => open("new")}>
              <Plus className="size-4" aria-hidden="true" />
              Novo provento
            </Button>
          ) : null
        }
      />

      {data.investments.length === 0 ? (
        <Card>
          <EmptyState
            title="Primeiro, um investimento"
            text="Os proventos ficam ligados aos investimentos da sua carteira."
            action={
              <Link href="/app/investimentos" className={buttonClass("secondary", true)}>
                Ir para Investimentos
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          <dl className="m-0 grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatTile
              label="Média por mês"
              value={formatBRL(summary.monthlyAverage)}
              hint="Nos últimos 12 meses."
            />
            <StatTile label="Neste ano" value={formatBRL(summary.thisYear)} />
            <StatTile
              label="Imposto retido"
              value={formatBRL(summary.withheld12)}
              hint="Nos últimos 12 meses."
            />
            <StatTile
              label="Meta por mês"
              value={data.goal ? formatBRL(data.goal) : "Sem meta"}
              hint={
                summary.goalPercent === null
                  ? undefined
                  : `A média já cobre ${summary.goalPercent}% da meta.`
              }
            />
          </dl>

          {outlook ? <OutlookTiles outlook={outlook} /> : null}

          <Card
            title="Mês a mês"
            actions={
              writable ? (
                <Button variant="secondary" small onClick={() => open("goal")}>
                  <Target className="size-4" aria-hidden="true" />
                  Definir meta
                </Button>
              ) : null
            }
          >
            <DividendsChart points={summary.months} />
          </Card>

          {outlook ? <ForecastCard months={outlook.forecast} /> : null}

          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
            <Card title="Recebidos">
              {data.rows.length === 0 ? (
                <EmptyState
                  title="Nenhum provento ainda"
                  text="Registre dividendos, JCP e rendimentos conforme caem na conta."
                />
              ) : (
                <ul
                  aria-label="Proventos recebidos"
                  className="m-0 list-none divide-y divide-line p-0"
                >
                  {data.rows.map((row) => (
                    <li key={row.id} className="flex items-center gap-3 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          {row.label}
                          <Badge>{KIND_LABEL[row.kind]}</Badge>
                        </p>
                        <p className="text-xs text-muted">
                          {fullDate(row.paidOn)}
                          {money(row.withheld).gt(0) ? ` · bruto de ${formatBRL(row.gross)}` : ""}
                        </p>
                      </div>
                      <span className="whitespace-nowrap font-medium tabular-nums">
                        {formatBRL(netDividend(row))}
                      </span>
                      {writable ? (
                        <IconButton
                          label={`Excluir provento de ${row.label}`}
                          onClick={() => setRemoving(row)}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </IconButton>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Por investimento" description="Últimos 12 meses, sobre o que você pagou.">
              {data.byInvestment.length === 0 ? (
                <p className="text-sm text-muted">
                  Aparece quando houver provento nos últimos 12 meses.
                </p>
              ) : (
                <ul
                  aria-label="Por investimento"
                  className="m-0 list-none divide-y divide-line p-0"
                >
                  {data.byInvestment.map((item) => (
                    <li
                      key={item.investmentId}
                      className="flex items-center justify-between gap-3 py-2 text-sm"
                    >
                      <span className="min-w-0 truncate font-medium">{item.label}</span>
                      <span className="whitespace-nowrap tabular-nums">
                        {formatBRL(item.net)}
                        {item.yieldOnCost !== null
                          ? ` · ${item.yieldOnCost.toLocaleString("pt-BR")}%`
                          : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}

      <Sheet
        open={sheet !== null}
        onClose={close}
        title={sheet?.type === "goal" ? "Meta de proventos" : "Novo provento"}
      >
        {sheet?.type === "new" ? (
          <DividendForm key={sheet.nonce} data={data} onDone={close} />
        ) : null}
        {sheet?.type === "goal" ? <GoalForm key={sheet.nonce} data={data} onDone={close} /> : null}
      </Sheet>
      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Excluir provento"
        text={`O provento de ${removing?.label ?? ""} sai do histórico.`}
        confirmLabel="Excluir"
        action={deleteDividend}
        hidden={{ id: removing?.id ?? "" }}
      />
    </div>
  );
}
