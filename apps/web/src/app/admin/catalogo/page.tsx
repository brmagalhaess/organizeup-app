import { adminCatalog, type AdminCatalogRow } from "@organizeup/db";
import { CONNECTED_ITEM } from "@organizeup/domain";
import type { Metadata } from "next";
import { Badge, Card, EmptyState, Field, FormMessage, Input } from "@/components/ui";
import { stripeUsable } from "@/lib/billing/stripe-key";
import { requireAdmin } from "@/lib/session";
import { ConfirmAction, Switch } from "../admin-actions";
import { keyNotice } from "../cobranca/estado";
import { formatDate } from "../format";
import { AdminPage, AdminTable, type Column } from "../kit";
import { ADMIN_DB_MISSING, hasAdminDatabase, noteAdminAccess } from "../painel";
import { brl, CYCLE_LABELS, itemLabel } from "../planos";
import { createStripePrice, setPrice, setSale } from "./actions";
import { linesOf, sectionLines, SECTIONS } from "./linhas";

export const metadata: Metadata = { title: "Catálogo" };

const columns: Column[] = [
  { key: "item", label: "Item", primary: true },
  { key: "cycle", label: "Ciclo" },
  { key: "price", label: "Preço", align: "right" },
  { key: "sale", label: "À venda" },
  { key: "stripe", label: "Na Stripe" },
  { key: "actions", label: "Ações" },
];

function StripeCell({ row, usable }: { row: AdminCatalogRow; usable: boolean }) {
  if (row.hasStripePrice) return <Badge tone="success">Criado</Badge>;
  if (!row.onSale) return <Badge>Sem preço</Badge>;
  if (!usable) return <Badge tone="warning">Sem preço</Badge>;
  const label = `${itemLabel(row.item)}, ${CYCLE_LABELS[row.cycle].toLowerCase()}`;
  return (
    <ConfirmAction
      label="Criar na Stripe"
      ariaLabel={`Criar na Stripe: ${label}`}
      action={createStripePrice}
      hidden={{ id: row.id }}
      title="Criar preço na Stripe"
      text={`Cria o preço de ${brl(row.amount)} para ${label}. Ele fica na Stripe mesmo que saia de venda aqui.`}
      confirmLabel="Criar"
    />
  );
}

export default async function AdminCatalogPage() {
  const session = await requireAdmin();
  await noteAdminAccess(session.user.id, "catalogo:ver");
  if (!hasAdminDatabase()) {
    return (
      <AdminPage title="Catálogo">
        <Card>
          <FormMessage message={ADMIN_DB_MISSING} />
        </Card>
      </AdminPage>
    );
  }

  const lines = linesOf(await adminCatalog());
  const usable = stripeUsable();
  const key = keyNotice();

  return (
    <AdminPage
      title="Catálogo"
      description="Preço novo vale só para quem assinar depois: quem já assina continua no preço com que entrou."
    >
      <p className="m-0 rounded-2xl bg-card-soft p-4 text-sm">
        {usable
          ? `${key.text} Criar preço na Stripe só acontece quando você clica.`
          : `${key.text} Sem ela, os preços ficam salvos aqui, e criar na Stripe fica para depois.`}{" "}
        Enquanto um item à venda não tiver preço na Stripe, ninguém consegue assinar esse item.
      </p>
      {lines.length === 0 ? (
        <Card>
          <EmptyState title="Catálogo vazio" text="Disponível depois da próxima atualização." />
        </Card>
      ) : null}
      {SECTIONS.map((section) => {
        const rows = sectionLines(section, lines);
        if (rows.length === 0) return null;
        return (
          <Card key={section.title} title={section.title} description={section.description}>
            <AdminTable
              caption={section.title}
              columns={columns}
              rows={rows.map(({ current, older }) => {
                const name = `${itemLabel(current.item)}, ${CYCLE_LABELS[current.cycle].toLowerCase()}`;
                const hidden = { item: current.item, cycle: current.cycle };
                return {
                  // Não o id da linha: preço novo troca o id, e o botão perderia a resposta da action.
                  id: `${current.item}|${current.cycle}`,
                  cells: {
                    item: itemLabel(current.item),
                    cycle: CYCLE_LABELS[current.cycle],
                    price: (
                      <>
                        {brl(current.amount)}
                        {older.length > 0 ? (
                          <span className="block text-xs font-normal text-muted">
                            Antes: {older.map((row) => brl(row.amount)).join(", ")}
                          </span>
                        ) : null}
                      </>
                    ),
                    sale:
                      current.item === CONNECTED_ITEM ? (
                        <Badge tone="warning">Bloqueado</Badge>
                      ) : (
                        <Switch
                          label={`Vender ${name}`}
                          checked={current.onSale}
                          action={setSale}
                          hidden={hidden}
                        />
                      ),
                    stripe: <StripeCell row={current} usable={usable} />,
                    actions: (
                      <ConfirmAction
                        label="Preço novo"
                        ariaLabel={`Preço novo: ${name}`}
                        action={setPrice}
                        hidden={{ ...hidden, basedOn: current.id }}
                        title="Preço novo"
                        text={`Hoje: ${brl(current.amount)}, desde ${formatDate(current.createdAt)}. O preço antigo fica guardado, e quem assinou por ele continua nele.`}
                        confirmLabel="Salvar preço"
                        fields={
                          <Field label="Preço novo em reais" hint="Exemplo: 12,90.">
                            <Input name="amount" inputMode="decimal" autoComplete="off" required />
                          </Field>
                        }
                      />
                    ),
                  },
                };
              })}
            />
          </Card>
        );
      })}
    </AdminPage>
  );
}
