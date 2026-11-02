// Telas novas no detalhe da família: moeda, relatórios, notificações e dívidas. Só código, datas e contagens:
// nenhuma coluna de texto ou valor é lida.
import { adminFamilyProduct } from "@organizeup/db";
import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import { formatCount, formatDate } from "../../format";
import { Fact } from "../../kit";

export async function FamilyProduct({ id }: { id: string }) {
  const product = await adminFamilyProduct(id);
  return (
    <Card title="Telas" description="Moeda, relatórios e avisos, sem nenhum valor.">
      {product ? (
        <dl className="m-0 flex flex-col gap-3 text-sm">
          <Fact label="Moeda principal">{product.mainCurrency}</Fact>
          <Fact label="Relatórios da família">
            {formatCount(product.statements)}
            {product.lastStatementAt ? `, o último em ${formatDate(product.lastStatementAt)}` : ""}
          </Fact>
          <Fact label="Relatórios dos agentes">
            {formatCount(product.reports)}
            {product.lastReportAt ? `, o último em ${formatDate(product.lastReportAt)}` : ""}
          </Fact>
          <Fact label="Notificações">
            {formatCount(product.notifications)}, {formatCount(product.unread)} não lidas
          </Fact>
          <Fact label="Dívidas">
            <Badge tone={product.debts ? "success" : "neutral"}>
              {product.debts ? "Usa" : "Não usa"}
            </Badge>
          </Fact>
        </dl>
      ) : (
        <p className="m-0 text-sm text-muted">Disponível depois da próxima atualização.</p>
      )}
      <Link
        href={`/admin/assinaturas/${id}`}
        className="mt-4 inline-block text-sm font-semibold text-brand-700 underline underline-offset-2"
      >
        Ver assinatura
      </Link>
    </Card>
  );
}
