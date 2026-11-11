import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import {
  accounts,
  asc,
  canWrite,
  creditCards,
  householdTimezone,
  withHousehold,
} from "@organizeup/db";
import { BANK_FEED_ERRORS, todayIn, type BankFeedError } from "@organizeup/domain";
import { Card, PageHeader } from "@/components/ui";
import { systemTextOf } from "@/i18n/system-text";
import {
  BANK_KEYS_PER_LOGIN,
  loadBankConnections,
  loadBankPeople,
  requireBankFeed,
} from "@/lib/bank-feed";
import { connectionVaultReady } from "@/lib/connection-vault";
import { ConnectionsBoard } from "./connections-board";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("conexoes");
  return { title: t("metaTitle") };
}

export default async function BankConnectionsPage() {
  const { ctx } = await requireBankFeed();
  const [t, tSystem] = await Promise.all([getTranslations("conexoes"), getTranslations("sistema")]);
  const system = systemTextOf(tSystem);
  const [connections, persons, family] = await Promise.all([
    loadBankConnections(ctx),
    loadBankPeople(ctx),
    withHousehold(ctx, async (tx) => ({
      accounts: await tx
        .select({
          id: accounts.id,
          name: accounts.name,
          currency: accounts.currency,
          archived: accounts.archived,
        })
        .from(accounts)
        .orderBy(asc(accounts.createdAt)),
      cards: await tx
        .select({ id: creditCards.id, name: creditCards.name, archived: creditCards.archived })
        .from(creditCards)
        .orderBy(asc(creditCards.createdAt)),
      timezone: await householdTimezone(tx, ctx.householdId),
    })),
  ]);
  const blocked = !canWrite(ctx)
    ? t("noPermission")
    : !connectionVaultReady()
      ? t("unavailable")
      : null;
  const known = (code: string | null): code is BankFeedError =>
    code !== null && (BANK_FEED_ERRORS as readonly string[]).includes(code);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      {blocked ? (
        <Card>
          <p className="text-sm text-muted">{blocked}</p>
        </Card>
      ) : (
        <ConnectionsBoard
          connections={connections.map((connection) => ({
            id: connection.id,
            personName: connection.personName,
            itemIds: connection.itemIds,
            checkedOn: connection.checkedAt ? todayIn(family.timezone, connection.checkedAt) : null,
            error: known(connection.errorCode) ? t(`errors.${connection.errorCode}`) : null,
            links: connection.links,
          }))}
          people={persons
            .filter((person) => !person.connected)
            .map(({ id, name, self }) => ({ id, name, self }))}
          room={Math.max(0, BANK_KEYS_PER_LOGIN - connections.length)}
          cards={family.cards
            .filter((card) => !card.archived)
            .map(({ id, name }) => ({ id, name: system.name(name) }))}
          accounts={family.accounts
            .filter((account) => !account.archived)
            .map(({ id, name, currency }) => ({ id, name: system.name(name), currency }))}
        />
      )}
    </div>
  );
}
