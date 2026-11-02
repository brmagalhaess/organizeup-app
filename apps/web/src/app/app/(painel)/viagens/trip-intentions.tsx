"use client";
// Bloco "Quero conhecer" (ADR-0026). A família mantém a lista; o agente lê de madrugada e a situação de
// cada lugar vem do relatório dele. Quem só pode ver lê tudo, sem botões.
import { Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useActionState, useEffect, useMemo, useState, type ReactNode } from "react";
import { money, normalizePlace, searchDestinations } from "@organizeup/domain";
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
  Select,
  Sheet,
  submitKeeping,
} from "@/components/ui";
import { formatDate, formatMonthYear, monthName, monthNames } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { useBrazilRules, useMoney } from "@/i18n/money";
import type {
  CatalogDestination,
  IntentionState,
  TripIntentionItem,
  TripIntentions as Data,
} from "@/lib/suggestions";
import { deleteIntention, reopenIntention, saveIntention, type FormState } from "./actions";

const initial: FormState = { ok: false, message: null };

const REGIONS = [
  "brasil_perto",
  "brasil",
  "america_sul",
  "america_norte",
  "europa",
  "asia_oceania",
] as const;

/** Estimativa em reais inteiros: o centavo daria uma precisão que a tabela não tem. */
const whole = (value: string, moneyText: (value: string) => string) =>
  moneyText(money(value).toDecimalPlaces(0).toFixed(2)).replace(/[.,]00(?=\D*$)/, "");

function DestinationField({
  catalog,
  item,
}: {
  catalog: CatalogDestination[];
  item: TripIntentionItem | null;
}) {
  const t = useTranslations("viagens.intentions.form");
  const tRegions = useTranslations("viagens.regions");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<CatalogDestination | null>(
    catalog.find((row) => row.id === item?.destinationId) ?? null,
  );
  const [customName, setCustomName] = useState<string | null>(
    item && !item.destinationId ? item.name : null,
  );
  const term = normalizePlace(query);
  const found = useMemo(() => searchDestinations(catalog, term), [catalog, term]);

  if (picked) {
    return (
      <>
        <input type="hidden" name="destinationId" value={picked.id} />
        <div className="flex items-start justify-between gap-3 rounded-xl border border-line bg-card-soft p-3">
          <div className="min-w-0 text-sm">
            <p className="m-0 font-semibold">{picked.name}</p>
            <p className="m-0 text-muted">{tRegions(picked.region)}</p>
          </div>
          <Button type="button" variant="ghost" small onClick={() => setPicked(null)}>
            {t("change")}
          </Button>
        </div>
      </>
    );
  }

  if (customName !== null) {
    return (
      <>
        <Field label={t("customName")} hint={t("customHint")}>
          <Input name="customName" required maxLength={80} defaultValue={customName} />
        </Field>
        <Field label={t("region")}>
          <Select name="customRegion" required defaultValue={item?.customRegion ?? ""}>
            <option value="" disabled>
              {t("regionChoose")}
            </option>
            {REGIONS.map((region) => (
              <option key={region} value={region}>
                {tRegions(region)}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          type="button"
          variant="ghost"
          small
          className="self-start"
          onClick={() => setCustomName(null)}
        >
          {t("fromCatalog")}
        </Button>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Field label={t("search")} hint={t("searchHint")}>
        <Input
          autoComplete="off"
          placeholder={t("searchPlaceholder")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </Field>
      {found.length > 0 ? (
        <ul aria-label={t("found")} className="m-0 flex list-none flex-col gap-1 p-0">
          {found.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => setPicked(row)}
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-line bg-card-soft px-3 py-2 text-left text-sm"
              >
                <span className="min-w-0 truncate font-semibold">{row.name}</span>
                <span className="shrink-0 text-muted">{tRegions(row.region)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {term.length >= 2 && found.length === 0 ? (
        <p className="m-0 text-sm text-muted">{t("notFound")}</p>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        small
        className="self-start"
        onClick={() => setCustomName(query.trim())}
      >
        {t("useCustom")}
      </Button>
    </div>
  );
}

function IntentionForm({
  item,
  catalog,
  onDone,
}: {
  item: TripIntentionItem | null;
  catalog: CatalogDestination[];
  onDone: () => void;
}) {
  const t = useTranslations("viagens.intentions.form");
  const tCommon = useTranslations("common");
  const locale = useLocale() as Locale;
  const [state, action, pending] = useActionState(saveIntention, initial);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={item?.id ?? ""} />
      <DestinationField catalog={catalog} item={item} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("month")}>
          <Select name="preferredMonth" defaultValue={item?.preferredMonth ?? ""}>
            <option value="">{t("monthAny")}</option>
            {monthNames(locale).map((name, index) => (
              <option key={name} value={index + 1}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("days")} hint={t("daysHint")}>
          <Input
            name="days"
            type="number"
            inputMode="numeric"
            min={1}
            max={60}
            defaultValue={item?.days ?? ""}
          />
        </Field>
      </div>
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? tCommon("saving") : t("save")}
      </Button>
    </form>
  );
}

function badgeOf(state: IntentionState) {
  switch (state.status) {
    case "aguardando":
      return { key: "aguardando", tone: "neutral" } as const;
    case "sugerida":
      return { key: "sugerida", tone: "success" } as const;
    case "recusada":
      return { key: "recusada", tone: "neutral" } as const;
    case "atendida":
      return { key: "atendida", tone: "success" } as const;
    case "nao_cabe":
      return { key: "naoCabe", tone: "warning" } as const;
    case "sem_vaga":
      return { key: "semVaga", tone: "warning" } as const;
    case "uma_por_ano":
      return { key: "umaPorAno", tone: "neutral" } as const;
    case "criancas":
      return { key: "criancas", tone: "warning" } as const;
    default:
      return { key: "semEstimativa", tone: "warning" } as const;
  }
}

function StateText({ state }: { state: IntentionState }) {
  const t = useTranslations("viagens.intentions.states");
  const locale = useLocale() as Locale;
  const moneyText = useMoney();
  const link = (chunks: ReactNode) => (
    <Link href="/app/configuracoes" className="font-medium underline underline-offset-2">
      {chunks}
    </Link>
  );
  switch (state.status) {
    case "aguardando":
      return t("aguardando");
    case "sugerida":
      return t("sugerida", { month: formatMonthYear(state.month, locale) });
    case "recusada":
      return t("recusada", { year: state.untilYear + 1 });
    case "atendida":
      return state.trip
        ? t("atendida", { date: formatDate(state.trip.startOn, locale) })
        : t("atendidaSemViagem");
    case "nao_cabe": {
      const values = {
        total: whole(state.total, moneyText),
        extra: moneyText(state.extraMonthly),
      };
      return state.firstMonth
        ? t("naoCabeMes", { ...values, month: formatMonthYear(state.firstMonth, locale) })
        : t("naoCabe", values);
    }
    case "sem_vaga":
      return t.rich("semVaga", { total: whole(state.total, moneyText), link });
    case "uma_por_ano":
      return t.rich("umaPorAno", { link });
    case "criancas":
      return t("criancas");
    default:
      return t("semEstimativa");
  }
}

function IntentionCard({
  item,
  active,
  writable,
  onEdit,
  onRemove,
  onRedo,
}: {
  item: TripIntentionItem;
  /** Falso fora do real: o agente não usa a lista, então nenhuma situação vale. */
  active: boolean;
  writable: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onRedo: () => void;
}) {
  const t = useTranslations("viagens.intentions");
  const tRegions = useTranslations("viagens.regions");
  const locale = useLocale() as Locale;
  const { name, state } = item;
  const badge = badgeOf(state);
  const meta = [
    item.preferredMonth
      ? t("meta.month", { month: monthName(item.preferredMonth, locale) })
      : t("meta.anyMonth"),
    item.days ? t("meta.days", { days: item.days }) : t("meta.defaultDays"),
    ...(item.customRegion ? [t("meta.region", { region: tRegions(item.customRegion) })] : []),
  ];
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold break-words">
            <span className="min-w-0 break-words">{name}</span>
            {active ? <Badge tone={badge.tone}>{t(`badges.${badge.key}`)}</Badge> : null}
          </h3>
          <p className="mt-1 text-sm text-muted">{meta.join(" · ")}</p>
        </div>
        {writable ? (
          <div className="flex shrink-0">
            {active ? (
              <IconButton label={t("edit", { name })} onClick={onEdit}>
                <Pencil className="size-4" aria-hidden="true" />
              </IconButton>
            ) : null}
            <IconButton label={t("remove", { name })} onClick={onRemove}>
              <Trash2 className="size-4" aria-hidden="true" />
            </IconButton>
          </div>
        ) : null}
      </div>
      {active ? (
        <p className="m-0 text-sm">
          <StateText state={state} />
        </p>
      ) : null}
      {active && writable && state.status === "atendida" ? (
        <Button
          variant="secondary"
          small
          className="self-start"
          aria-label={t("redoAria", { name })}
          onClick={onRedo}
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          {t("redo")}
        </Button>
      ) : null}
    </li>
  );
}

type Open = { nonce: number; item: TripIntentionItem | null };

export function TripIntentions({ data, writable }: { data: Data; writable: boolean }) {
  const t = useTranslations("viagens.intentions");
  const brazil = useBrazilRules();
  const [sheet, setSheet] = useState<Open | null>(null);
  const [removing, setRemoving] = useState<TripIntentionItem | null>(null);
  const [redoing, setRedoing] = useState<TripIntentionItem | null>(null);
  const close = () => setSheet(null);
  const open = (item: TripIntentionItem | null) =>
    setSheet((s) => ({ item, nonce: (s?.nonce ?? 0) + 1 }));
  const canAdd = writable && brazil;
  const add = (
    <Button variant="secondary" small onClick={() => open(null)}>
      <Plus className="size-4" aria-hidden="true" />
      {t("add")}
    </Button>
  );

  return (
    <Card
      title={t("title")}
      description={brazil ? t("description") : t("foreign")}
      actions={canAdd && data.items.length > 0 ? add : null}
    >
      {data.items.length === 0 ? (
        brazil ? (
          <EmptyState
            title={t("empty.title")}
            text={t("empty.text")}
            action={canAdd ? add : undefined}
          />
        ) : null
      ) : (
        <ul
          aria-label={t("listLabel")}
          className="m-0 grid list-none grid-cols-1 gap-4 p-0 lg:grid-cols-2"
        >
          {data.items.map((item) => (
            <IntentionCard
              key={item.id}
              item={item}
              active={brazil}
              writable={writable}
              onEdit={() => open(item)}
              onRemove={() => setRemoving(item)}
              onRedo={() => setRedoing(item)}
            />
          ))}
        </ul>
      )}
      <Sheet
        open={sheet !== null}
        onClose={close}
        title={sheet?.item ? t("sheets.edit") : t("sheets.new")}
      >
        {sheet ? (
          <IntentionForm
            key={sheet.nonce}
            item={sheet.item}
            catalog={data.catalog}
            onDone={close}
          />
        ) : null}
      </Sheet>
      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t("removeSheet.title")}
        text={t("removeSheet.text", { name: removing?.name ?? "" })}
        confirmLabel={t("removeSheet.confirm")}
        action={deleteIntention}
        hidden={{ id: removing?.id ?? "" }}
      />
      <ConfirmSheet
        open={redoing !== null}
        onClose={() => setRedoing(null)}
        title={t("redoSheet.title")}
        text={t("redoSheet.text", { name: redoing?.name ?? "" })}
        confirmLabel={t("redoSheet.confirm")}
        action={reopenIntention}
        hidden={{ id: redoing?.id ?? "" }}
      />
    </Card>
  );
}
