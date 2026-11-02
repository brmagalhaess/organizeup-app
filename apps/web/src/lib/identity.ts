// Documento da conta, do lado da web (ADR-0022): cifra ao gravar e, ao ler, entrega só o mascarado.
// O texto puro existe em memória durante a requisição e não passa daqui, nem em erro nem em log.
import "server-only";
import {
  readUserIdentity,
  saveUserIdentity,
  type AdminSealedIdentity,
  type IdentityColumns,
  type UserIdentityRow,
} from "@organizeup/db";
import {
  formatCnpj,
  formatCpf,
  maskCnpj,
  maskCpf,
  type Identity,
  type PersonType,
} from "@organizeup/domain";
import { documentHash, openDocument, sealDocument, vaultReady } from "./document-vault";

export type StoreResult = "ok" | "refused" | "unavailable";

/** Só o nome do problema e o código do banco: a mensagem de erro do Postgres pode citar a linha. */
function logIdentity(msg: string, error?: unknown) {
  const code = (error as { code?: string } | undefined)?.code;
  const cause = (error as { cause?: { code?: string } } | undefined)?.cause?.code;
  console.error(JSON.stringify({ level: "error", msg, code: code ?? cause }));
}

export function logVaultMissing() {
  logIdentity("document_key_missing");
}

const NO_DOCUMENT = {
  personType: null,
  cpfEncrypted: null,
  cpfHash: null,
  cnpjEncrypted: null,
  cnpjHash: null,
  companyNameEncrypted: null,
};

function sealedColumns(userId: string, identity: Identity): IdentityColumns {
  if (!identity.inBrazil) return { inBrazil: false, ...NO_DOCUMENT };
  const { personType, cpf, cnpj, companyName } = identity;
  return {
    inBrazil: true,
    personType,
    cpfEncrypted: sealDocument(cpf, { userId, field: "cpf" }),
    cpfHash: documentHash("cpf", cpf),
    cnpjEncrypted: cnpj ? sealDocument(cnpj, { userId, field: "cnpj" }) : null,
    cnpjHash: cnpj ? documentHash("cnpj", cnpj) : null,
    companyNameEncrypted: companyName
      ? sealDocument(companyName, { userId, field: "companyName" })
      : null,
  };
}

/**
 * Grava cifrado ou não grava. Sem a chave recusa em vez de guardar em texto puro, e quem mora fora não
 * precisa dela. `refused` é o que a pessoa vê como mensagem neutra: documento em outra conta, ou esta conta
 * tentando trocar o que já informou. A tela não distingue os dois.
 */
export async function storeIdentity(userId: string, identity: Identity): Promise<StoreResult> {
  if (identity.inBrazil && !vaultReady()) {
    logVaultMissing();
    return "unavailable";
  }
  try {
    const saved = await saveUserIdentity(userId, sealedColumns(userId, identity));
    return saved === "ok" ? "ok" : "refused";
  } catch (error) {
    logIdentity("document_save_failed", error);
    return "unavailable";
  }
}

export interface IdentityView {
  /** Conta sem resposta nenhuma: o pedido aparece uma vez. */
  ask: boolean;
  /** Mora no Brasil, sem documento: dá para informar em Configurações. */
  canFill: boolean;
  abroad: boolean;
  personType: PersonType | null;
  /** Mascarado. Null sem a chave: a tela diz que há documento, sem mostrar nada. */
  cpf: string | null;
  cnpj: string | null;
  companyName: string | null;
}

export function viewOf(userId: string, row: UserIdentityRow | null): IdentityView {
  const personType = row?.personType ?? null;
  const cpf = row?.cpfEncrypted && openDocument(row.cpfEncrypted, { userId, field: "cpf" });
  const cnpj = row?.cnpjEncrypted && openDocument(row.cnpjEncrypted, { userId, field: "cnpj" });
  const companyName =
    row?.companyNameEncrypted &&
    openDocument(row.companyNameEncrypted, { userId, field: "companyName" });
  return {
    ask: row === null,
    canFill: personType === null,
    abroad: row?.inBrazil === false,
    personType,
    cpf: cpf ? maskCpf(cpf) : null,
    cnpj: cnpj ? maskCnpj(cnpj) : null,
    companyName: companyName || null,
  };
}

export async function identityView(userId: string): Promise<IdentityView> {
  return viewOf(userId, await readUserIdentity(userId));
}

/** Convite no painel. Falhar aqui nunca derruba a tela, e sem a chave não há como atender ao pedido. */
export async function shouldAskDocument(userId: string): Promise<boolean> {
  try {
    return vaultReady() && (await readUserIdentity(userId)) === null;
  } catch (error) {
    logIdentity("document_read_failed", error);
    return false;
  }
}

/** Quem se cadastrou como empresa? Falhar aqui não impede de criar o espaço: fica como família. */
export async function isCompanyPerson(userId: string): Promise<boolean> {
  try {
    return (await readUserIdentity(userId))?.personType === "pj";
  } catch (error) {
    logIdentity("document_read_failed", error);
    return false;
  }
}

/**
 * Documento completo para o painel, depois da ação registrada. Null sem a chave. É o único caminho que
 * devolve o documento inteiro, e quem chama precisa ter passado por `adminRevealIdentity`.
 */
export function openedIdentity(userId: string, sealed: AdminSealedIdentity) {
  const cpf = openDocument(sealed.cpfEncrypted, { userId, field: "cpf" });
  if (!cpf) return null;
  const open = (value: string | null, field: "cnpj" | "companyName") =>
    value ? openDocument(value, { userId, field }) : null;
  const cnpj = open(sealed.cnpjEncrypted, "cnpj");
  return {
    cpf: formatCpf(cpf),
    cnpj: cnpj ? formatCnpj(cnpj) : null,
    companyName: open(sealed.companyNameEncrypted, "companyName"),
  };
}

export const EXPORT_NOTICE =
  "CPF e CNPJ saem mascarados, de propósito: este arquivo pode ser copiado e encaminhado. Aparece só o documento de quem baixou. O completo fica cifrado e, para consultá-lo ou corrigi-lo, fale com o suporte.";

/** O que entra no arquivo de dados: só da conta de quem baixou, mascarado e com o aviso. */
export async function identityForExport(userId: string) {
  const view = await identityView(userId);
  return {
    aviso: EXPORT_NOTICE,
    tipo: view.personType,
    cpf: view.cpf,
    cnpj: view.cnpj,
    // A razão social de MEI costuma trazer o CPF: os números não saem.
    razaoSocial: view.companyName?.replace(/\d/g, "*") ?? null,
  };
}
