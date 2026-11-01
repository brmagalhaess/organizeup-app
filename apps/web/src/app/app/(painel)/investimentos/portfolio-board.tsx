"use client";
import { History, Pencil, Plus, Tag, Target, Trash2, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { formatBRL, isUnitPriced, money, stockEventKind } from "@organizeup/domain";
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
import type { loadPortfolio } from "@/lib/investments";
import type { PendingItem } from "@/lib/suggestions";
import {
  DecisionButtons,
  SuggestionFeedback,
  useSuggestionActions,
} from "../sugestoes/suggestion-controls";
import {
  addTrade,
  deleteInvestment,
  deleteTrade,
  saveInvestment,
  saveTargets,
  updateValue,
  type FormState,
} from "./actions";

type Data = Awaited<ReturnType<typeof loadPortfolio>>;
type Row = Data["rows"][number];
type Trade = Row["trades"][number];

const CLASS_LABEL: Record<string, string> = {
  acao: "Ações",
  fii: "Fundos imobiliários",
  etf_bdr: "ETFs e BDRs",
  renda_fixa: "Renda fixa",
  fundo: "Fundos",
  previdencia: "Previdência",
  exterior: "Exterior",
  outro: "Outros",
};

const initial: FormState = { ok: false, message: null };
const fullDate = (date: string) => date.split("-").reverse().join("/");
const quantityText = (value: string) => money(value).toNumber().toLocaleString("pt-BR");
const toInput = (value: string | null) =>
  value === null ? "" : money(value).toString().replace(".", ",");
const percentText = (value: number) => `${value.toLocaleString("pt-BR")}%`;
const daysSince = (date: string, today: string) =>
  Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);

/** Linha sob o investimento dizendo de onde vem o preço, ou o que falta para ele vir sozinho. */
function QuoteNote({ row, today }: { row: Row; today: string }) {
  switch (row.quoteState) {
    case "automatico": {
      const age = row.quoteDate ? daysSince(row.quoteDate, today) : 0;
      return (
        <p className="text-xs text-muted">
          Atualizado automaticamente em {fullDate(row.valuedOn ?? today)}
          {row.quoteSource ? ` · fonte: ${row.quoteSource}` : ""}
          {age > 0 ? ` · cotação de há ${age === 1 ? "1 dia" : `${age} dias`}` : " · com atraso"}
        </p>
      );
    }
    case "sem_ticker":
      return (
        <p className="text-xs text-muted">
          Preencha o código em Editar para o preço e os proventos virem sozinhos.
        </p>
      );
    case "ticker_invalido":
      return (
        <p className="text-xs text-danger">
          Não encontramos o código {row.ticker}. Corrija em Editar; sem ele, nada vem sozinho.
        </p>
      );
    case "aguardando":
      return <p className="text-xs text-muted">O preço automático chega na próxima atualização.</p>;
    case "sem_plano":
      return (
        <p className="text-xs text-muted">
          Este ativo ainda não tem cotação automática. Atualize o valor por aqui.
        </p>
      );
    default:
      return null;
  }
}

function useCloseOnSuccess(state: FormState, onDone: () => void) {
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
}

function InvestmentForm({ row, onDone }: { row: Row | null; onDone: () => void }) {
  const [state, action, pending] = useActionState(saveInvestment, initial);
  useCloseOnSuccess(state, onDone);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={row?.id ?? ""} />
      <Field label="Nome">
        <Input
          name="name"
          required
          maxLength={80}
          placeholder="Ex.: Tesouro Selic 2031"
          defaultValue={row?.name}
        />
      </Field>
      <Field label="Classe">
        <Select name="assetClass" defaultValue={row?.assetClass ?? "acao"}>
          {Object.entries(CLASS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Código"
        hint="Ex.: PETR4, HGLG11. Em ações, fundos imobiliários, ETFs e BDRs, é o que traz o preço e os proventos sozinhos."
      >
        <Input name="ticker" maxLength={12} defaultValue={row?.ticker ?? ""} />
      </Field>
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando…" : "Salvar investimento"}
      </Button>
    </form>
  );
}

function TradeForm({ row, today, onDone }: { row: Row; today: string; onDone: () => void }) {
  const [state, action, pending] = useActionState(addTrade, initial);
  useCloseOnSuccess(state, onDone);
  const unit = isUnitPriced(row.assetClass);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <input type="hidden" name="investmentId" value={row.id} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Operação">
          <Select name="side" defaultValue="compra">
            <option value="compra">{unit ? "Compra" : "Aplicação"}</option>
            <option value="venda">{unit ? "Venda" : "Resgate"}</option>
          </Select>
        </Field>
        <Field label="Data">
          <Input name="occurredOn" type="date" required defaultValue={today} />
        </Field>
      </div>
      {unit ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantidade">
            <Input name="quantity" inputMode="decimal" required placeholder="100" />
          </Field>
          <Field label="Preço (R$)">
            <Input name="unitPrice" inputMode="decimal" required placeholder="32,50" />
          </Field>
        </div>
      ) : (
        <Field label="Valor (R$)">
          <Input name="amount" inputMode="decimal" required placeholder="1.000,00" />
        </Field>
      )}
      <Field label="Taxas (R$)" hint="Opcional. Entram no preço médio.">
        <Input name="fees" inputMode="decimal" placeholder="0,00" />
      </Field>
      <p className="text-xs text-muted">
        Isto não mexe nas suas contas. Se o dinheiro saiu de uma conta do sistema, ajuste o saldo
        dela para não contar duas vezes no patrimônio.
      </p>
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando…" : "Salvar operação"}
      </Button>
    </form>
  );
}

function ValueForm({ row, today, onDone }: { row: Row; today: string; onDone: () => void }) {
  const [state, action, pending] = useActionState(updateValue, initial);
  useCloseOnSuccess(state, onDone);
  const unit = isUnitPriced(row.assetClass);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={row.id} />
      <div className="grid grid-cols-[3fr_2fr] gap-3">
        <Field
          label={unit ? "Preço de hoje (R$)" : "Valor total hoje (R$)"}
          hint={
            row.quoteState === "automatico" || row.quoteState === "informado"
              ? "Vale até a próxima cotação automática."
              : unit
                ? "Preço de uma unidade."
                : "Como aparece no extrato."
          }
        >
          <Input
            name="value"
            inputMode="decimal"
            required
            placeholder="0,00"
            defaultValue={toInput(unit ? row.currentPrice : row.currentValue)}
          />
        </Field>
        <Field label="Data">
          <Input name="valuedOn" type="date" required defaultValue={today} />
        </Field>
      </div>
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando…" : "Salvar valor"}
      </Button>
    </form>
  );
}

function TargetsForm({ data, onDone }: { data: Data; onDone: () => void }) {
  const [state, action, pending] = useActionState(saveTargets, initial);
  useCloseOnSuccess(state, onDone);
  const percentOf = (assetClass: string) =>
    toInput(data.targets.find((t) => t.assetClass === assetClass)?.percent ?? null);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Diga quanto da carteira você quer em cada classe. A decisão é sua: o sistema só compara e
        não indica ativo nenhum.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {Object.entries(CLASS_LABEL).map(([value, label]) => (
          <Field key={value} label={`${label} (%)`}>
            <Input
              name={value}
              inputMode="decimal"
              placeholder="0"
              defaultValue={percentOf(value)}
            />
          </Field>
        ))}
      </div>
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando…" : "Salvar metas"}
      </Button>
    </form>
  );
}

function ClassBars({ data }: { data: Data }) {
  return (
    <ul aria-label="Carteira por classe" className="m-0 flex list-none flex-col gap-4 p-0">
      {data.summary.classes.map((share) => {
        const gap = share.toTarget === null ? null : money(share.toTarget);
        return (
          <li key={share.assetClass} className="text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">
                {CLASS_LABEL[share.assetClass] ?? share.assetClass}
              </span>
              <span className="whitespace-nowrap tabular-nums">
                {formatBRL(share.value)} · {percentText(share.percent)}
              </span>
            </div>
            <div className="relative mt-1.5 h-2 rounded-full bg-brand-50" aria-hidden="true">
              <div
                className="h-2 rounded-full bg-brand-500"
                style={{ width: `${Math.min(100, share.percent)}%` }}
              />
              {share.target !== null ? (
                <span
                  className="absolute -top-1 h-4 w-0.5 bg-ink"
                  style={{ left: `${Math.min(100, share.target)}%` }}
                />
              ) : null}
            </div>
            {gap !== null ? (
              <p className="mt-1 text-xs text-muted">
                Meta de {percentText(share.target ?? 0)}:{" "}
                {gap.abs().lt(1)
                  ? "na meta"
                  : gap.gt(0)
                    ? `${formatBRL(gap)} abaixo`
                    : `${formatBRL(gap.abs())} acima`}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function History_({
  row,
  writable,
  onRemove,
}: {
  row: Row;
  writable: boolean;
  onRemove: (trade: Trade) => void;
}) {
  const unit = isUnitPriced(row.assetClass);
  if (row.trades.length === 0)
    return <p className="text-sm text-muted">Nenhuma operação registrada.</p>;
  return (
    <ul aria-label="Operações" className="m-0 list-none divide-y divide-line p-0">
      {row.trades.map((trade) => {
        const total = money(trade.quantity).times(trade.unitPrice);
        const buying = trade.side === "compra";
        return (
          <li key={trade.id} className="flex items-center gap-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {unit ? (buying ? "Compra" : "Venda") : buying ? "Aplicação" : "Resgate"} de{" "}
                {unit
                  ? `${quantityText(trade.quantity)} a ${formatBRL(trade.unitPrice)}`
                  : formatBRL(total)}
              </p>
              <p className="text-xs text-muted">
                {fullDate(trade.occurredOn)}
                {money(trade.fees).gt(0) ? ` · taxas de ${formatBRL(trade.fees)}` : ""}
              </p>
            </div>
            {writable ? (
              <IconButton label="Excluir operação" onClick={() => onRemove(trade)}>
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Avisos do assistente. Fica montado depois da última decisão para mostrar a mensagem. */
function PortfolioSuggestions({ items, writable }: { items: PendingItem[]; writable: boolean }) {
  const actions = useSuggestionActions();
  if (items.length === 0) return <SuggestionFeedback result={actions.result} />;
  return (
    <Card title="Sugestões do assistente">
      <SuggestionFeedback result={actions.result} />
      <ul aria-label="Sugestões do assistente" className="m-0 list-none divide-y divide-line p-0">
        {items.map((item) => (
          <li key={item.id} className="py-3 first:pt-0 last:pb-0">
            <p className="text-sm font-medium">{item.title}</p>
            <p className="mt-1 text-sm text-muted">{item.body}</p>
            {writable ? (
              <DecisionButtons id={item.id} title={item.title} actions={actions} />
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

type Sheet_ =
  | { type: "new" | "targets"; nonce: number }
  | { type: "edit" | "trade" | "value" | "history"; nonce: number; id: string };

const TITLES: Record<Sheet_["type"], string> = {
  new: "Novo investimento",
  targets: "Metas por classe",
  edit: "Editar investimento",
  trade: "Registrar operação",
  value: "Atualizar valor",
  history: "Operações",
};

export function PortfolioBoard({
  data,
  suggestions,
  stalePriceDays,
  writable,
}: {
  data: Data;
  suggestions: PendingItem[];
  /** A partir de quantos dias o valor informado conta como velho. */
  stalePriceDays: number;
  writable: boolean;
}) {
  const [sheet, setSheet] = useState<Sheet_ | null>(null);
  const [removing, setRemoving] = useState<Row | null>(null);
  const [removingTrade, setRemovingTrade] = useState<Trade | null>(null);
  const close = () => setSheet(null);
  const open = (type: "new" | "targets") => setSheet((s) => ({ type, nonce: (s?.nonce ?? 0) + 1 }));
  const openRow = (type: "edit" | "trade" | "value" | "history", id: string) =>
    setSheet((s) => ({ type, id, nonce: (s?.nonce ?? 0) + 1 }));
  const selected =
    sheet && "id" in sheet ? (data.rows.find((row) => row.id === sheet.id) ?? null) : null;
  const { summary } = data;
  const gain = money(summary.gain);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Investimentos"
        title={formatBRL(summary.total)}
        description="Quanto vale hoje o que você registrou."
        actions={
          writable ? (
            <Button variant="secondary" onClick={() => open("new")}>
              <Plus className="size-4" aria-hidden="true" />
              Novo investimento
            </Button>
          ) : null
        }
      />

      <PortfolioSuggestions items={suggestions} writable={writable} />

      {data.rows.length === 0 ? (
        <Card>
          <EmptyState
            title="Sua carteira começa aqui"
            text="Cadastre ações, fundos, renda fixa ou previdência. O valor entra no seu patrimônio. Se já tiver esse dinheiro em uma conta de investimento no sistema, use só um dos dois."
            action={
              writable ? (
                <Button variant="secondary" small onClick={() => open("new")}>
                  Adicionar investimento
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <dl className="m-0 grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatTile
              label="Custo"
              value={formatBRL(summary.cost)}
              hint="O que ainda está aplicado."
            />
            <StatTile
              label="Resultado"
              value={formatBRL(summary.gain)}
              hint={
                summary.gainPercent === null
                  ? undefined
                  : `${gain.gt(0) ? "+" : ""}${percentText(summary.gainPercent)} sobre o custo.`
              }
            />
            <StatTile
              label="Já realizado"
              value={formatBRL(summary.realized)}
              hint="Resultado das vendas e resgates."
            />
            <StatTile
              label="Proventos"
              value={formatBRL(data.dividends12)}
              hint="Recebidos em 12 meses."
            />
          </dl>

          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Card title="Carteira">
              <ul aria-label="Carteira" className="m-0 list-none divide-y divide-line p-0">
                {data.rows.map((row) => {
                  const unit = isUnitPriced(row.assetClass);
                  const rowGain = money(row.gain);
                  // Com cotação automática, o aviso de preço velho não vale.
                  const hasQuote = row.quoteState === "automatico";
                  const priceAge =
                    row.valuedOn && !row.estimated && !hasQuote
                      ? daysSince(row.valuedOn, data.today)
                      : 0;
                  return (
                    <li key={row.id} className="py-3 first:pt-0">
                      <div className="flex items-start gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                          <TrendingUp className="size-4" aria-hidden="true" />
                        </span>
                        <div className="min-w-0 flex-1 text-sm">
                          <p className="flex flex-wrap items-center gap-2 font-medium">
                            {row.name}
                            {row.ticker ? <Badge>{row.ticker}</Badge> : null}
                            {priceAge > stalePriceDays ? (
                              <Badge tone="warning">preço de há {priceAge} dias</Badge>
                            ) : null}
                          </p>
                          <p className="text-xs text-muted">
                            {CLASS_LABEL[row.assetClass]}
                            {unit && money(row.position.quantity).gt(0)
                              ? ` · ${quantityText(row.position.quantity)} a ${formatBRL(row.position.averagePrice)} em média`
                              : ""}
                          </p>
                          {row.events.map((event) => (
                            <p key={event.id} className="text-xs text-muted">
                              Quantidade ajustada por {stockEventKind(event.note)} em{" "}
                              {fullDate(event.comDate)}
                            </p>
                          ))}
                          {row.position.oversold ? (
                            <p className="text-xs text-danger">
                              Há venda maior que a posição. Confira as operações.
                            </p>
                          ) : null}
                          {row.estimated ? (
                            <p className="text-xs text-muted">
                              Sem valor atual: mostrando o custo.
                            </p>
                          ) : row.valuedOn && !hasQuote ? (
                            <p className="text-xs text-muted">Valor de {fullDate(row.valuedOn)}</p>
                          ) : null}
                          <QuoteNote row={row} today={data.today} />
                        </div>
                        <div className="text-right text-sm">
                          <p className="whitespace-nowrap font-medium tabular-nums">
                            {formatBRL(row.value)}
                          </p>
                          {!row.estimated && row.gainPercent !== null ? (
                            <p className="whitespace-nowrap text-xs tabular-nums text-muted">
                              {rowGain.gt(0) ? "+" : ""}
                              {percentText(row.gainPercent)}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1 pl-12">
                        {writable ? (
                          <>
                            <Button
                              variant="secondary"
                              small
                              aria-label={`Registrar operação de ${row.name}`}
                              onClick={() => openRow("trade", row.id)}
                            >
                              Operação
                            </Button>
                            <Button
                              variant="secondary"
                              small
                              aria-label={`Atualizar valor de ${row.name}`}
                              onClick={() => openRow("value", row.id)}
                            >
                              <Tag className="size-4" aria-hidden="true" />
                              Valor
                            </Button>
                          </>
                        ) : null}
                        <IconButton
                          label={`Operações de ${row.name}`}
                          onClick={() => openRow("history", row.id)}
                        >
                          <History className="size-4" aria-hidden="true" />
                        </IconButton>
                        {writable ? (
                          <>
                            <IconButton
                              label={`Editar ${row.name}`}
                              onClick={() => openRow("edit", row.id)}
                            >
                              <Pencil className="size-4" aria-hidden="true" />
                            </IconButton>
                            <IconButton
                              label={`Excluir ${row.name}`}
                              onClick={() => setRemoving(row)}
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                            </IconButton>
                          </>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>

            <Card
              title="Por classe"
              description="A marca mostra a sua meta."
              actions={
                writable ? (
                  <Button variant="secondary" small onClick={() => open("targets")}>
                    <Target className="size-4" aria-hidden="true" />
                    Metas
                  </Button>
                ) : null
              }
            >
              <ClassBars data={data} />
            </Card>
          </div>
        </>
      )}

      <p className="text-xs text-muted">
        Ações, fundos imobiliários, ETFs e BDRs com código válido têm preço automático, atualizado
        depois do fechamento da bolsa e sempre com atraso. O resto é informado por você. O
        OrganizeUp organiza e compara, e não recomenda compra ou venda de investimentos. Veja também
        os{" "}
        <Link href="/app/proventos" className="font-semibold text-brand-700 underline">
          proventos
        </Link>
        .
      </p>

      <Sheet
        open={sheet !== null}
        onClose={close}
        title={
          sheet
            ? selected && sheet.type === "history"
              ? `Operações de ${selected.name}`
              : TITLES[sheet.type]
            : ""
        }
      >
        {sheet?.type === "new" ? (
          <InvestmentForm key={sheet.nonce} row={null} onDone={close} />
        ) : null}
        {sheet?.type === "targets" ? (
          <TargetsForm key={sheet.nonce} data={data} onDone={close} />
        ) : null}
        {sheet?.type === "edit" && selected ? (
          <InvestmentForm key={sheet.nonce} row={selected} onDone={close} />
        ) : null}
        {sheet?.type === "trade" && selected ? (
          <TradeForm key={sheet.nonce} row={selected} today={data.today} onDone={close} />
        ) : null}
        {sheet?.type === "value" && selected ? (
          <ValueForm key={sheet.nonce} row={selected} today={data.today} onDone={close} />
        ) : null}
        {sheet?.type === "history" && selected ? (
          <History_ row={selected} writable={writable} onRemove={setRemovingTrade} />
        ) : null}
      </Sheet>
      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Excluir investimento"
        text={`"${removing?.name ?? ""}" sai da carteira, com as operações e os proventos dele.`}
        confirmLabel="Excluir"
        action={deleteInvestment}
        hidden={{ id: removing?.id ?? "" }}
      />
      <ConfirmSheet
        open={removingTrade !== null}
        onClose={() => setRemovingTrade(null)}
        title="Excluir operação"
        text="A posição e o preço médio serão recalculados."
        confirmLabel="Excluir"
        action={deleteTrade}
        hidden={{ id: removingTrade?.id ?? "" }}
      />
    </div>
  );
}
