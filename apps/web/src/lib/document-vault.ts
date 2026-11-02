// Cofre do documento da conta (ADR-0022). AES-256-GCM, com a conta e o campo como dado autenticado:
// copiar o valor cifrado para outra linha não abre. O hash é HMAC com chave própria, derivada da mesma
// variável por HKDF: sem a chave, ninguém testa os CPFs possíveis contra ele. Nada aqui registra valor.
import "server-only";
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;

export type VaultField = "cpf" | "cnpj" | "companyName";

export interface VaultRef {
  userId: string;
  field: VaultField;
}

function deriveKeys() {
  const raw = process.env.DOCUMENT_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  const master = Buffer.from(raw, "base64");
  if (master.length !== 32) return null;
  const derive = (purpose: string) =>
    Buffer.from(hkdfSync("sha256", master, "", `organizeup:documento:${purpose}`, 32));
  return { cipher: derive("cifra"), hash: derive("hash") };
}

/** Falso sem a variável, ou com ela fora do formato: 32 bytes em base64. */
export const vaultReady = () => deriveKeys() !== null;

const context = ({ userId, field }: VaultRef) => Buffer.from(`${userId}:${field}`);

/** Cifra. Sem a chave lança erro: nunca devolve o texto como veio. */
export function sealDocument(plain: string, ref: VaultRef): string {
  const keys = deriveKeys();
  if (!keys) throw new Error("document_key_missing");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keys.cipher, iv);
  cipher.setAAD(context(ref));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), data]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

/** Abre. Sem a chave, com a chave errada ou com valor adulterado devolve null. */
export function openDocument(sealed: string, ref: VaultRef): string | null {
  const keys = deriveKeys();
  const [version, iv, tag, data] = sealed.split(".");
  if (!keys || version !== VERSION || !iv || !tag || data === undefined) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", keys.cipher, Buffer.from(iv, "base64url"));
    decipher.setAAD(context(ref));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(data, "base64url")),
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
