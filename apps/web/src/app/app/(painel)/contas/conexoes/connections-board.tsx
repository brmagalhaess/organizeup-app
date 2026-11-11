"use client";
import {
  CreditCard,
  ExternalLink,
  Landmark,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useActionState, useState } from "react";
import { buttonClass } from "@/components/styles";
import {
  Badge,
  Button,
  Card,
  ConfirmSheet,
  EmptyState,
  Field,
  FormMessage,
  Input,
  Select,
} from "@/components/ui";
import { formatDate } from "@/i18n/format";
import type { BankLink } from "@/lib/bank-feed";
import {
  createBankAccounts,
  linkBank,
  linkCard,
  refreshBankConnection,
  removeBankConnection,
  saveBankConnection,
  type ConnectionFormState,
} from "./actions";

const initial: ConnectionFormState = { ok: false, message: null };
const STEPS = [
  "account",
  "dashboard",
  "application",
  "secret",
  "enable",
  "connector",
  "items",
  "paste",
] as const;
const TERMS = ["own", "password", "review", "joint", "free"] as const;

interface AccountOption {
  id: string;
  name: string;
  currency: string;
}

interface CardOption {
  id: string;
  name: string;
}

/** O mesmo valor de `BANK_CREATE`, no servidor: cria a conta ou o cartão em vez de escolher um. */
const CREATE = "nova";

interface PersonOption {
  id: string;
  name: string;
  self: boolean;
}

interface ConnectionView {
  id: string;
  personName: string;
  itemIds: string[];
  checkedOn: string | null;
  error: string | null;
  links: BankLink[];
}

function Guide() {
  const t = useTranslations("conexoes");
  return (
    <Card title={t("how.title")} description={t("how.text")}>
      <ol className="m-0 flex list-decimal flex-col gap-2 pl-5 text-sm">
        {STEPS.map((step) => (
          <li key={step}>{t(`how.steps.${step}`)}</li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href="https://meu.pluggy.ai"
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClass("secondary", true)}
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          {t("links.meu")}
        </a>
        <a
          href="https://dashboard.pluggy.ai"
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClass("secondary", true)}
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          {t("links.dashboard")}
        </a>
      </div>
      <div className="mt-5 rounded-xl border border-line bg-card-soft p-4">
        <p className="m-0 flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="size-4 text-success" aria-hidden="true" />
          {t("terms.title")}
        </p>
        <ul className="m-0 mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-muted">
          {TERMS.map((item) => (
            <li key={item}>{t(`terms.${item}`)}</li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

/** Campos das chaves. Numa chave já guardada, Client ID e Client Secret em branco mantêm o que está lá. */
function KeyFields({ stored, itemIds }: { stored: boolean; itemIds: string }) {
  const t = useTranslations("conexoes");
  const keep = stored ? { hint: t("form.keepHint") } : {};
  return (
    <>
      <Field label={t("form.clientId")} {...keep}>
        <Input
          name="clientId"
          required={!stored}
          maxLength={60}
          autoComplete="off"
          spellCheck={false}
          placeholder="00000000-0000-0000-0000-000000000000"
        />
      </Field>
      <Field label={t("form.clientSecret")} {...keep}>
        <Input
          name="clientSecret"
          type="password"
          required={!stored}
          maxLength={200}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <Field label={t("form.itemIds")} hint={t("form.itemIdsHint")}>
        <Input
          name="itemIds"
          required
          defaultValue={itemIds}
          maxLength={400}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
    </>
  );
}

function NewKeyForm({ people, room }: { people: PersonOption[]; room: number }) {
  const t = useTranslations("conexoes");
  const [state, action, pending] = useActionState(saveBankConnection, initial);
  const [personId, setPersonId] = useState(
    (people.find((person) => person.self) ?? people[0])?.id ?? "",
  );
  const other = people.some((person) => person.id === personId && !person.self);
  return (
    <Card title={t("form.titleAdd")} description={t("form.textAdd")}>
      {room === 0 ? (
        <p className="m-0 text-sm text-muted">{t("form.limit")}</p>
      ) : people.length === 0 ? (
        <p className="m-0 text-sm text-muted">
          {t("form.noPeople")}{" "}
          <Link href="/app/familia" className="font-semibold underline">
            {t("form.openPeople")}
          </Link>
        </p>
      ) : (
        <form action={action} className="flex max-w-xl flex-col gap-4" autoComplete="off">
          <Field label={t("form.person")}>
            <Select
              name="personId"
              value={personId}
              onChange={(event) => setPersonId(event.target.value)}
            >
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.self ? t("form.personSelf", { name: person.name }) : person.name}
                </option>
              ))}
            </Select>
          </Field>
          <KeyFields stored={false} itemIds="" />
          {other ? (
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" name="consent" required className="mt-1 size-4 shrink-0" />
              <span>{t("form.consent")}</span>
            </label>
          ) : null}
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? t("form.saving") : t("form.save")}
            </Button>
          </div>
          <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
        </form>
      )}
    </Card>
  );
}

function EditKeyForm({ connection }: { connection: ConnectionView }) {
  const t = useTranslations("conexoes");
  const [state, action, pending] = useActionState(saveBankConnection, initial);
  return (
    <details className="mt-4 rounded-xl border border-line p-4">
      <summary className="cursor-pointer text-sm font-semibold">{t("form.edit")}</summary>
      <form action={action} className="mt-4 flex max-w-xl flex-col gap-4" autoComplete="off">
        <input type="hidden" name="connectionId" value={connection.id} />
        <KeyFields stored itemIds={connection.itemIds.join(", ")} />
        <div>
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? t("form.saving") : t("form.save")}
          </Button>
        </div>
        <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      </form>
    </details>
  );
}

function LinkTitle({ link }: { link: BankLink }) {
  const t = useTranslations("conexoes");
  const locale = useLocale();
  const Icon = link.kind === "cartao" ? CreditCard : Landmark;
  const linked = link.kind === "cartao" ? link.cardId : link.accountId;
  return (
    <div className="min-w-0">
      <p className="m-0 flex flex-wrap items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 shrink-0 text-muted" aria-hidden="true" />
        <span className="break-words">
          {link.numberTail
            ? `${link.name} · ${t("accounts.tail", { tail: link.numberTail })}`
            : link.name}
        </span>
        <Badge tone={linked ? "success" : "neutral"}>{t(`accounts.kind.${link.kind}`)}</Badge>
      </p>
      <p className="m-0 mt-1 text-xs text-muted">
        {!linked
          ? t("accounts.unlinked")
          : link.syncedOn
            ? t("accounts.synced", { date: formatDate(link.syncedOn, locale) })
            : t("accounts.never")}
      </p>
    </div>
  );
}

function AccountRow({ link, accounts }: { link: BankLink; accounts: AccountOption[] }) {
  const t = useTranslations("conexoes");
  const [state, action, pending] = useActionState(linkBank, initial);
  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-end sm:justify-between">
      <LinkTitle link={link} />
      <form action={action} className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-80">
        <input type="hidden" name="linkId" value={link.id} />
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field label={t("accounts.target")}>
              <Select name="accountId" defaultValue={link.accountId ?? CREATE}>
                <option value={CREATE}>{t("accounts.create")}</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
                <option value="">{t("accounts.none")}</option>
              </Select>
            </Field>
          </div>
          <Button type="submit" variant="secondary" disabled={pending}>
            {t("accounts.save")}
          </Button>
        </div>
        <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      </form>
    </li>
  );
}

/** Fechamento sugerido quando a instituição só informa o vencimento: uma semana antes. */
const closingBefore = (dueDay: number) => ((dueDay - 8 + 31) % 31) + 1;

function CardRow({
  link,
  cards,
  accounts,
}: {
  link: BankLink;
  cards: CardOption[];
  accounts: AccountOption[];
}) {
  const t = useTranslations("conexoes");
  const [state, action, pending] = useActionState(linkCard, initial);
  const [cardId, setCardId] = useState(link.cardId ?? CREATE);
  const paying = accounts.filter((account) => account.currency === "BRL");
  return (
    <li className="flex flex-col gap-3 py-4">
      <LinkTitle link={link} />
      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="linkId" value={link.id} />
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Field label={t("cards.target")}>
            <Select
              name="cardId"
              value={cardId}
              onChange={(event) => setCardId(event.target.value)}
            >
              <option value={CREATE}>{t("cards.create")}</option>
              {cards.map((card) => (
                <option key={card.id} value={card.id}>
                  {card.name}
                </option>
              ))}
              <option value="">{t("accounts.none")}</option>
            </Select>
          </Field>
          <Button type="submit" variant="secondary" disabled={pending}>
            {t("accounts.save")}
          </Button>
        </div>
        {cardId === CREATE ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[8rem_8rem_minmax(0,1fr)]">
            <Field label={t("cards.closingDay")}>
              <Input
                name="closingDay"
                type="number"
                min={1}
                max={31}
                required
                defaultValue={link.closingDay ?? (link.dueDay ? closingBefore(link.dueDay) : "")}
              />
            </Field>
            <Field label={t("cards.dueDay")}>
              <Input
                name="dueDay"
                type="number"
                min={1}
                max={31}
                required
                defaultValue={link.dueDay ?? ""}
              />
            </Field>
            <div className="col-span-2 sm:col-span-1">
              <Field label={t("cards.payingAccount")} hint={t("cards.payingHint")}>
                <Select name="payingAccountId" required defaultValue={paying[0]?.id ?? ""}>
                  {paying.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
        ) : null}
        {cardId === CREATE && paying.length === 0 ? (
          <p className="m-0 text-sm text-muted">{t("cards.needAccount")}</p>
        ) : null}
        <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      </form>
    </li>
  );
}

function ConnectionCard({
  connection,
  accounts,
  cards,
  onRemove,
}: {
  connection: ConnectionView;
  accounts: AccountOption[];
  cards: CardOption[];
  onRemove: () => void;
}) {
  const t = useTranslations("conexoes");
  const locale = useLocale();
  const [state, refresh, refreshing] = useActionState(refreshBankConnection, initial);
  const [created, createAll, creating] = useActionState(createBankAccounts, initial);
  const missing = connection.links.filter((link) => link.kind !== "cartao" && !link.accountId);
  return (
    <Card
      title={t("status.title", { name: connection.personName })}
      description={[
        t("status.items", { count: connection.itemIds.length }),
        connection.checkedOn
          ? t("status.checked", { date: formatDate(connection.checkedOn, locale) })
          : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      actions={
        connection.error ? (
          <Badge tone="warning">{t("status.attention")}</Badge>
        ) : (
          <Badge tone="success">{t("status.ok")}</Badge>
        )
      }
    >
      {connection.error ? (
        <p className="m-0 mb-3 text-sm text-muted" role="status">
          {t("status.error", { message: connection.error })}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <form action={refresh}>
          <input type="hidden" name="connectionId" value={connection.id} />
          <Button type="submit" variant="secondary" small disabled={refreshing}>
            <RefreshCw className="size-4" aria-hidden="true" />
            {refreshing ? t("actions.refreshing") : t("actions.refresh")}
          </Button>
        </form>
        {missing.length > 0 ? (
          <form action={createAll}>
            <input type="hidden" name="connectionId" value={connection.id} />
            <Button type="submit" small disabled={creating}>
              <Plus className="size-4" aria-hidden="true" />
              {t("actions.createAccounts", { count: missing.length })}
            </Button>
          </form>
        ) : null}
        <Button variant="secondary" small onClick={onRemove}>
          <Trash2 className="size-4" aria-hidden="true" />
          {t("actions.remove")}
        </Button>
      </div>
      <div className="mt-3">
        <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
        <FormMessage message={created.message} tone={created.ok ? "ok" : "error"} />
      </div>

      <h3 className="m-0 mt-4 text-sm font-semibold">{t("accounts.title")}</h3>
      <p className="m-0 mt-1 text-sm text-muted">{t("accounts.text")}</p>
      {connection.links.length === 0 ? (
        <EmptyState title={t("accounts.emptyTitle")} text={t("accounts.emptyText")} />
      ) : (
        <ul className="m-0 list-none divide-y divide-line p-0">
          {connection.links.map((link) =>
            link.kind === "cartao" ? (
              <CardRow
                key={`${link.id}:${link.cardId ?? ""}`}
                link={link}
                cards={cards}
                accounts={accounts}
              />
            ) : (
              <AccountRow
                key={`${link.id}:${link.accountId ?? ""}`}
                link={link}
                accounts={accounts}
              />
            ),
          )}
        </ul>
      )}
      <EditKeyForm connection={connection} />
    </Card>
  );
}

export function ConnectionsBoard({
  connections,
  people,
  room,
  accounts,
  cards,
}: {
  connections: ConnectionView[];
  /** Pessoas do cadastro que ainda podem receber uma chave. */
  people: PersonOption[];
  /** Quantas chaves ainda cabem neste login. */
  room: number;
  accounts: AccountOption[];
  cards: CardOption[];
}) {
  const t = useTranslations("conexoes");
  const [removing, setRemoving] = useState<ConnectionView | null>(null);
  const linked = connections.some((connection) =>
    connection.links.some((link) => link.accountId || link.cardId),
  );
  return (
    <>
      {connections.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {linked ? (
            <Link href="/app/importar" className={buttonClass()}>
              {t("actions.entries")}
            </Link>
          ) : null}
          <Link href="/app/investimentos/importar" className={buttonClass("secondary")}>
            {t("actions.investments")}
          </Link>
        </div>
      ) : null}
      {connections.map((connection) => (
        <ConnectionCard
          key={connection.id}
          connection={connection}
          accounts={accounts}
          cards={cards}
          onRemove={() => setRemoving(connection)}
        />
      ))}
      <Guide />
      <NewKeyForm key={`${room}:${people.length}`} people={people} room={room} />
      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t("remove.title", { name: removing?.personName ?? "" })}
        text={t("remove.text")}
        confirmLabel={t("remove.confirm")}
        action={removeBankConnection}
        hidden={{ id: removing?.id ?? "" }}
      />
    </>
  );
}
