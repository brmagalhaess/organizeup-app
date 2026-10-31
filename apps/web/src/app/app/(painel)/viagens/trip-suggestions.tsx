"use client";
import Link from "next/link";
import { addMonths, formatBRL, formatYearMonth, money, type YearMonth } from "@organizeup/domain";
import { Badge, Card } from "@/components/ui";
import type { TripSuggestionItem, TripSuggestions as Data } from "@/lib/suggestions";
import {
  DecisionButtons,
  SuggestionFeedback,
  useSuggestionActions,
  type SuggestionActions,
} from "../sugestoes/suggestion-controls";

const CONFIDENCE: Record<TripSuggestionItem["confidence"], string> = {
  baixa: "confiança baixa",
  media: "confiança média",
};

/** Estimativa em reais inteiros: o centavo daria uma precisão que a tabela não tem. */
const rounded = (value: string) => formatBRL(money(value).toDecimalPlaces(0)).replace(/,00$/, "");

/** "julho" neste ano, "julho de 2027" nos seguintes. */
function monthLabel(month: YearMonth, today: string) {
  const label = formatYearMonth(month);
  return month.slice(0, 4) === today.slice(0, 4) ? label.split(" de ")[0]! : label;
}

function travelersLabel(adults: number, children: number) {
  const grown = `${adults} ${adults === 1 ? "adulto" : "adultos"}`;
  if (children === 0) return grown;
  return `${grown} e ${children} ${children === 1 ? "criança" : "crianças"}`;
}

function SuggestionCard({
  item,
  today,
  writable,
  actions,
}: {
  item: TripSuggestionItem;
  today: string;
  writable: boolean;
  actions: SuggestionActions;
}) {
  const perPerson =
    item.perPerson ?? money(item.total).dividedBy(Math.max(1, item.personIds.length)).toString();
  const when = monthLabel(item.month, today);
  return (
    <li className="rounded-xl border border-line p-4">
      <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold">
        {item.name}
        {item.fits ? null : <Badge tone="warning">Acima do que sobra hoje</Badge>}
      </h3>
      <p className="mt-1 text-sm text-muted">
        Em {when} · {item.days} {item.days === 1 ? "dia" : "dias"}
      </p>
      <p className="mt-2 text-sm font-medium">
        Cerca de {rounded(item.total)} ({rounded(perPerson)} por pessoa)
      </p>
      <p className="mt-1 text-sm">
        {item.fits
          ? `Guarde ${rounded(item.monthlyToSave)} por mês até ${monthLabel(addMonths(item.month, -1), today)}`
          : `Pede ${rounded(item.monthlyToSave)} por mês, mais do que sobra para viagens hoje`}
      </p>
      <p className="mt-2 text-xs text-muted">
        {item.source} ({CONFIDENCE[item.confidence]})
      </p>
      {writable ? (
        <DecisionButtons
          id={item.id}
          title={`${item.name} em ${when}`}
          acceptLabel="Adicionar às minhas viagens"
          actions={actions}
        />
      ) : null}
    </li>
  );
}

export function TripSuggestions({ data, writable }: { data: Data; writable: boolean }) {
  const actions = useSuggestionActions();

  if (data.items.length === 0 && data.tripsPerYear === 0)
    return (
      <Card>
        <p className="text-sm">
          Quer sugestões de viagem? Diga quantas viagens por ano em{" "}
          <Link href="/app/configuracoes" className="font-medium underline underline-offset-2">
            Configurações › Plano
          </Link>
          .
        </p>
      </Card>
    );

  return (
    <Card
      title="Sugestões para o próximo ano"
      {...(data.items.length > 0
        ? {
            description: `Valores aproximados, pela nossa tabela de custos de ${data.tableYear} para ${travelersLabel(data.adults, data.children)}. Confira passagens e hospedagem antes de fechar.`,
          }
        : {})}
    >
      <SuggestionFeedback result={actions.result} />
      {data.items.length === 0 ? (
        <p className="text-sm text-muted">
          Nenhuma sugestão agora. O assistente volta a olhar toda madrugada.
        </p>
      ) : (
        <ul
          aria-label="Sugestões para o próximo ano"
          className="m-0 mt-2 grid list-none grid-cols-1 gap-4 p-0 lg:grid-cols-2"
        >
          {data.items.map((item) => (
            <SuggestionCard
              key={item.id}
              item={item}
              today={data.today}
              writable={writable}
              actions={actions}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}
