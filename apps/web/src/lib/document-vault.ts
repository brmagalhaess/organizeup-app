// Cofre do documento da conta (ADR-0022). AES-256-GCM, com a conta e o campo como dado autenticado:
// copiar o valor cifrado para outra linha não abre. O hash é HMAC com chave própria, derivada da mesma
// variável por HKDF: sem a chave, ninguém testa os CPFs possíveis contra ele. Nada aqui registra valor.
//
// Formato: `v1.<kid>.<iv>.<tag>.<dado>`. `kid` é a impressão digital da chave, e não revela nada dela: é o que
// mostra que a chave foi trocada, caso em que os hashes antigos deixam de casar.
import "server-only";
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_ID_BYTES = 6;
/** 32 bytes em base64 padrão: o que `openssl rand -base64 32` escreve. */
const BASE64_KEY = /^[A-Za-z0-9+/]{43}=$/;

export type VaultField = "cpf" | "cnpj" | "companyName";

export interface VaultRef {
  userId: string;
  field: VaultField;
}

function deriveKeys() {
  const raw = process.env.DOCUMENT_ENCRYPTION_KEY?.trim();
  if (!raw || !BASE64_KEY.test(raw)) return null;
  const master = Buffer.from(raw, "base64");
  const derive = (purpose: string, size = 32) =>
    Buffer.from(hkdfSync("sha256", master, "", `organizeup:documento:${purpose}`, size));
  return {
    cipher: derive("cifra"),
    hash: derive("hash"),
    id: derive("impressao", KEY_ID_BYTES).toString("base64url"),
  };
}

/** Falso sem a variável, ou com ela fora do formato: 32 bytes em base64. */
export const vaultReady = () => deriveKeys() !== null;

/** Impressão digital da chave atual. Null sem chave. */
export const vaultKeyId = () => deriveKeys()?.id ?? null;

const context = ({ userId, field }: VaultRef) => Buffer.from(`${userId}:${field}`);

/** Cifra. Sem a chave lança erro: nunca devolve o texto como veio. */
export function sealDocument(plain: string, ref: VaultRef): string {
  const keys = deriveKeys();
  if (!keys) throw new Error("document_key_missing");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keys.cipher, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(context(ref));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    VERSION,
    keys.id,
    ...[iv, cipher.getAuthTag(), data].map((p) => p.toString("base64url")),
  ].join(".");
}

/** Abre. Sem a chave, com a chave errada ou com valor adulterado devolve null. */
export function openDocument(sealed: string, ref: VaultRef): string | null {
  const keys = deriveKeys();
  const [version, keyId, ivText, tagText, dataText, ...extra] = sealed.split(".");
  if (!keys || version !== VERSION || keyId !== keys.id || extra.length > 0) return null;
  if (ivText === undefined || tagText === undefined || dataText === undefined) return null;
  const iv = Buffer.from(ivText, "base64url");
  const tag = Buffer.from(tagText, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", keys.cipher, iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(context(ref));
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([
      decipher.update(Buffer.from(dataText, "base64url")),
      decipher.final(),
    ]);
    return plain.toString("utf8");
  } catch {
    return null;
  }
}

/** Mesmo documento, mesmo hash, para o índice único achar a duplicidade. */
export function documentHash(kind: "cpf" | "cnpj", value: string): string {
  const keys = deriveKeys();
  if (!keys) throw new Error("document_key_missing");
  return createHmac("sha256", keys.hash).update(`${kind}:${value}`).digest("hex");
}
