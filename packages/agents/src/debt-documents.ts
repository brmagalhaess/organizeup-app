// Arquivos das dívidas e a passagem de rascunho para dívida (ADR-0019). Tudo roda no `tx` recebido, com
// RLS. Listagem nunca traz o conteúdo. A dívida só nasce ou muda em `confirmDebtDocument`, com os
// valores que a pessoa conferiu (regra 7): `extracted` é rascunho e não entra em cálculo.
import {
  and,
  canWrite,
  debtDocumentMeta,
  debtDocuments,
  debtInstallments,
  debts,
  desc,
  eq,
  accounts,
  isNull,
  sql,
  type DebtDocumentStatus,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";
import {
  buildSchedule,
  DEBT_FILES_MAX_BYTES,
  money,
  toDbAmount,
  type DebtTerms,
  type ScheduleRow,
} from "@organizeup/domain";
import { recordAudit } from "./shared";

export type DebtDocumentRow = Awaited<ReturnType<typeof listDebtDocuments>>[number];

const READ_ONLY = "Seu papel nesta família não permite alterações.";
const QUOTA_MESSAGE = "A família chegou ao limite de 50 MB de arquivos. Apague algum para enviar.";

/** Metadados, do mais novo para o mais antigo. */
export async function listDebtDocuments(tx: TenantTx) {
  return tx.select(debtDocumentMeta).from(debtDocuments).orderBy(desc(debtDocuments.createdAt));
}

/** Só para baixar e para ler: é a única consulta que carrega o arquivo. */
export async function loadDebtDocumentFile(tx: TenantTx, id: string) {
  const [row] = await tx
    .select({
      fileName: debtDocuments.fileName,
      mediaType: debtDocuments.mediaType,
      content: debtDocuments.content,
    })
    .from(debtDocuments)
    .where(eq(debtDocuments.id, id));
  return row ?? null;
}

async function sha256Of(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type SaveDebtDocumentResult =
  | { ok: true; id: string; status: DebtDocumentStatus; duplicate: boolean }
  | { ok: false; code: "somente_leitura" | "cota" | "divida"; message: string };

/**
 * Guarda um arquivo já conferido por `checkDebtFile`. Mesmo conteúdo não duplica: devolve o que existe
 * e, se ele estiver solto e o pedido veio de uma dívida, liga. A trava vale até o fim da transação,
 * para dois envios ao mesmo tempo não passarem juntos pela cota.
 */
export async function saveDebtDocument(
  tx: TenantTx,
  ctx: TenantContext,
  file: { fileName: string; mediaType: string; bytes: Uint8Array; debtId?: string | null },
): Promise<SaveDebtDocumentResult> {
  if (!canWrite(ctx)) return { ok: false, code: "somente_leitura", message: READ_ONLY };
  const debtId = file.debtId ?? null;
  if (debtId) {
    const [debt] = await tx.select({ id: debts.id }).from(debts).where(eq(debts.id, debtId));
    if (!debt) return { ok: false, code: "divida", message: "Não achei essa dívida." };
  }
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`debt_documents:${ctx.householdId}`}, 0))`,
  );
  const sha256 = await sha256Of(file.bytes);
  const [existing] = await tx
    .select({ id: debtDocuments.id, debtId: debtDocuments.debtId, status: debtDocuments.status })
    .from(debtDocuments)
    .where(eq(debtDocuments.sha256, sha256));
  if (existing) {
    if (debtId && existing.debtId === null) {
      await tx
        .update(debtDocuments)
        .set({ debtId, updatedAt: new Date() })
        .where(eq(debtDocuments.id, existing.id));
    }
    return { ok: true, id: existing.id, status: existing.status, duplicate: true };
  }
  const [usage] = await tx
    .select({ total: sql<string>`coalesce(sum(${debtDocuments.sizeBytes}), 0)::text` })
    .from(debtDocuments);
  if (Number(usage?.total ?? 0) + file.bytes.length > DEBT_FILES_MAX_BYTES) {
    return { ok: false, code: "cota", message: QUOTA_MESSAGE };
  }
  const [row] = await tx
    .insert(debtDocuments)
    .values({
      householdId: ctx.householdId,
      debtId,
      fileName: file.fileName,
      mediaType: file.mediaType,
      sizeBytes: file.bytes.length,
      content: file.bytes,
      sha256,
      createdBy: ctx.userId,
    })
    .returning({ id: debtDocuments.id });
  await recordAudit(tx, ctx, "create", "debt_documents", row!.id);
  return { ok: true, id: row!.id, status: "guardado", duplicate: false };
}

export async function deleteDebtDocument(
  tx: TenantTx,
  ctx: TenantContext,
  id: string,
): Promise<boolean> {
  if (!canWrite(ctx)) return false;
  const removed = await tx
    .delete(debtDocuments)
    .where(eq(debtDocuments.id, id))
    .returning({ id: debtDocuments.id });
  if (removed.length === 0) return false;
  await recordAudit(tx, ctx, "delete", "debt_documents", id);
  return true;
}

export interface NewDebt {
  name: string;
  accountId: string;
  terms: DebtTerms;
}

const principalOf = (rows: Array<Pick<ScheduleRow, "principal">>) =>
  rows.reduce((acc, row) => acc.plus(row.principal), money(0));

/** A rotina do cadastro manual: cria a dívida com o calendário de parcelas. Devolve o id. */
export async function createDebtWithSchedule(
  tx: TenantTx,
  ctx: TenantContext,
  input: NewDebt,
): Promise<string> {
  const schedule = buildSchedule(input.terms);
  const [debt] = await tx
    .insert(debts)
    .values({
      householdId: ctx.householdId,
      accountId: input.accountId,
      name: input.name,
      system: input.terms.system,
      monthlyRate: input.terms.monthlyRate,
      originalBalance: toDbAmount(principalOf(schedule)),
      createdBy: ctx.userId,
    })
    .returning({ id: debts.id });
  await tx
    .insert(debtInstallments)
    .values(schedule.map((row) => ({ ...row, householdId: ctx.householdId, debtId: debt!.id })));
  await recordAudit(tx, ctx, "create", "debts", debt!.id);
  return debt!.id;
}

/** Troca as parcelas em aberto pelo calendário novo. O que foi pago fica como está. */
export async function updateDebtTerms(
  tx: TenantTx,
  ctx: TenantContext,
  debtId: string,
  terms: DebtTerms,
): Promise<void> {
  const schedule = buildSchedule(terms);
  const paid = await tx
    .select({ number: debtInstallments.number, principal: debtInstallments.principal })
    .from(debtInstallments)
    .where(
      and(eq(debtInstallments.debtId, debtId), sql`${debtInstallments.transactionId} is not null`),
    );
  await tx
    .delete(debtInstallments)
    .where(and(eq(debtInstallments.debtId, debtId), isNull(debtInstallments.transactionId)));
  const offset = paid.reduce((high, row) => Math.max(high, row.number), 0);
  await tx.insert(debtInstallments).values(
    schedule.map((row) => ({
      ...row,
      number: row.number + offset,
      householdId: ctx.householdId,
      debtId,
    })),
  );
  await tx
    .update(debts)
    .set({
      system: terms.system,
      monthlyRate: terms.monthlyRate,
      originalBalance: toDbAmount(principalOf(paid).plus(principalOf(schedule))),
    })
    .where(eq(debts.id, debtId));
  await recordAudit(tx, ctx, "update", "debts", debtId);
}

export interface ConfirmDebtDocument {
  documentId: string;
  name: string;
  accountId: string;
  terms: DebtTerms;
  /** Dívida que este arquivo atualiza. Sem ela, nasce uma dívida nova. */
  updateDebtId: string | null;
}

export type ConfirmResult = { ok: true; debtId: string } | { ok: false; message: string };

/** A pessoa conferiu: cria ou atualiza a dívida com os valores dela e liga o arquivo. */
export async function confirmDebtDocument(
  tx: TenantTx,
  ctx: TenantContext,
  input: ConfirmDebtDocument,
): Promise<ConfirmResult> {
  if (!canWrite(ctx)) return { ok: false, message: READ_ONLY };
  const [document] = await tx
    .select({ status: debtDocuments.status })
    .from(debtDocuments)
    .where(eq(debtDocuments.id, input.documentId))
    .for("update");
  if (!document) return { ok: false, message: "Não achei esse arquivo." };
  if (document.status === "confirmado") {
    return { ok: false, message: "Este arquivo já foi conferido." };
  }
  if (document.status === "lendo") {
    return { ok: false, message: "Este arquivo ainda está sendo lido. Aguarde um instante." };
  }
  const [account] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, input.accountId));
  if (!account) return { ok: false, message: "Escolha uma conta válida." };

  let debtId: string;
  if (input.updateDebtId) {
    debtId = input.updateDebtId;
    const [debt] = await tx.select({ id: debts.id }).from(debts).where(eq(debts.id, debtId));
    if (!debt) return { ok: false, message: "Não achei essa dívida." };
    await updateDebtTerms(tx, ctx, debtId, input.terms);
    await tx
      .update(debts)
      .set({ name: input.name, accountId: input.accountId })
      .where(eq(debts.id, debtId));
  } else {
    debtId = await createDebtWithSchedule(tx, ctx, input);
  }
  await tx
    .update(debtDocuments)
    .set({ debtId, status: "confirmado", updatedAt: new Date() })
    .where(eq(debtDocuments.id, input.documentId));
  await recordAudit(tx, ctx, "confirm", "debt_documents", input.documentId);
  return { ok: true, debtId };
}
