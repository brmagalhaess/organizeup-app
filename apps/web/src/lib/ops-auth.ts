import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Autentica chamadas da Ops API (agentes do Paperclip).
 * OPS_TOKEN_HASHES = lista separada por vírgula de SHA-256 (hex) dos tokens válidos.
 * Os tokens em si nunca ficam no servidor do app.
 */
export function isAuthorizedOpsRequest(
  authorization: string | null,
  configuredHashes: string | undefined = process.env.OPS_TOKEN_HASHES,
): boolean {
  if (!authorization || !configuredHashes) return false;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  const token = match?.[1]?.trim();
  if (!token || token.length < 32) return false;
  const digest = createHash("sha256").update(token).digest();
  return configuredHashes
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter((h) => /^[0-9a-f]{64}$/.test(h))
    .some((h) => timingSafeEqual(Buffer.from(h, "hex"), digest));
}
