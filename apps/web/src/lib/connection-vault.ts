// Cofre das chaves da Pluggy de cada pessoa (ADR-0038). O mesmo desenho do cofre de documentos (ADR-0022):
// AES-256-GCM, com a família, a pessoa, a conexão e o campo como dado autenticado, de modo que copiar o valor cifrado
// para outra linha não abre. A chave de cifra é derivada de `DOCUMENT_ENCRYPTION_KEY` por HKDF com um rótulo
// só deste cofre: quem abre documento não abre conexão, e vice-versa. Nada aqui registra valor.
//
// Formato: `v1.<kid>.<iv>.<tag>.<dado>`.
import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_ID_BYTES = 6;
/** 32 bytes em base64 padrão: o que `openssl rand -base64 32` escreve. */
const BASE64_KEY = /^[A-Za-z0-9+/]{43}=$/;

export interface ConnectionRef {
  householdId: string;
  userId: string;
  /** A linha da conexão: quem guarda duas chaves não troca uma pela outra. */
  connectionId: string;
  field: "clientId" | "clientSecret";
}

function deriveKeys() {
  const raw = process.env.DOCUMENT_ENCRYPTION_KEY?.trim();
  if (!raw || !BASE64_KEY.test(raw)) return null;
  const master = Buffer.from(raw, "base64");
  const derive = (purpose: string, size = 32) =>
    Buffer.from(hkdfSync("sha256", master, "", `organizeup:conexao:${purpose}`, size));
  return { cipher: derive("cifra"), id: derive("impressao", KEY_ID_BYTES).toString("base64url") };
}

/** Falso sem a variável, ou com ela fora do formato. Sem cofre não há conexão. */
export const connectionVaultReady = () => deriveKeys() !== null;

const context = ({ householdId, userId, connectionId, field }: ConnectionRef) =>
  Buffer.from(`${householdId}:${userId}:${connectionId}:pluggy:${field}`);

/** Cifra. Sem a chave lança erro: nunca devolve o texto como veio. */
export function sealSecret(plain: string, ref: ConnectionRef): string {
  const keys = deriveKeys();
  if (!keys) throw new Error("connection_key_missing");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keys.cipher, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(context(ref));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    VERSION,
    keys.id,
    ...[iv, cipher.getAuthTag(), data].map((part) => part.toString("base64url")),
  ].join(".");
}

/** Abre. Sem a chave, com a chave trocada, com valor adulterado ou de outra pessoa devolve null. */
export function openSecret(sealed: string, ref: ConnectionRef): string | null {
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
    return Buffer.concat([
      decipher.update(Buffer.from(dataText, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
