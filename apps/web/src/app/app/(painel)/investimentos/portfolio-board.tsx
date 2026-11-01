"use client";
import { History, Pencil, Plus, Tag, Trash2, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useActionState, useState, type ReactNode } from "react";
import { formatBRL, isUnitPriced, money, stockEventKind } from "@organizeup/domain";
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
import type { PendingItem } from "@/lib/suggestions";
import {
  DecisionButtons,
  SuggestionFeedback,
  useSuggestionActions,
} from "../sugestoes/suggestion-controls";
import { AddAssetForm } from "./add-asset-form";
import { deleteInvestment, saveInvestment, updateValue } from "./actions";
import {
  CLASS_LABEL,
  fullDate,
  initial,
  percentText,
  quantityText,
  toInput,
  useCloseOnSuccess,
  type Data,
  type Row,
} from "./shared";
import { TradeForm } from "./trade-form";

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
  { type: "new"; nonce: number } | { type: "edit" | "trade" | "value"; nonce: number; id: string };

const TITLES: Record<Sheet_["type"], string> = {
  new: "Novo investimento",
  edit: "Editar investimento",
  trade: "Registrar operação",
  value: "Atualizar valor",
};

export function PortfolioBoard({
  data,
  suggestions,
  stalePriceDays,
  writable,
  insights,
}: {
  data: Data;
  suggestions: PendingItem[];
  /** A partir de quantos dias o valor informado conta como velho. */
  stalePriceDays: number;
  writable: boolean;
  insights: ReactNode;
}) {
  const [sheet, setSheet] = useState<Sheet_ | null>(null);
  const [removing, setRemoving] = useState<Row | null>(null);
  const close = () => setSheet(null);
  const open = (type: "new") => setSheet((s) => ({ type, nonce: (s?.nonce ?? 0) + 1 }));
  const openRow = (type: "edit" | "trade" | "value", id: string) =>
    setSheet((s) => ({ type, id, nonce: (s?.nonce ?? 0) + 1 }));
  const selected =
    sheet && "id" in sheet ? (data.rows.find((row) => row.id === sheet.id) ?? null) : null;
  const { summary } = data;
  const gain = money(summary.gain);

  return (
    <>
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
      {insights}

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

          <div>
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
                        <Link
                          href={`/app/investimentos/lancamentos?ativo=${row.id}`}
                          aria-label={`Operações de ${row.name}`}
                          className={buttonClass("ghost", true)}
                        >
                          <History className="size-4" aria-hidden="true" />
                        </Link>
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

      <Sheet open={sheet !== null} onClose={close} title={sheet ? TITLES[sheet.type] : ""}>
        {sheet?.type === "new" ? (
          <AddAssetForm
            key={sheet.nonce}
            today={data.today}
            accounts={data.accounts}
            onDone={close}
          />
        ) : null}
        {sheet?.type === "edit" && selected ? (
          <InvestmentForm key={sheet.nonce} row={selected} onDone={close} />
        ) : null}
        {sheet?.type === "trade" && selected ? (
          <TradeForm
            key={sheet.nonce}
            row={selected}
            accounts={data.accounts}
            today={data.today}
            onDone={close}
          />
        ) : null}
        {sheet?.type === "value" && selected ? (
          <ValueForm key={sheet.nonce} row={selected} today={data.today} onDone={close} />
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
    </>
  );
}
