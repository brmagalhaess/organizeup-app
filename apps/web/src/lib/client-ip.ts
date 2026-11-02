// IP de quem chamou. O cliente escreve o que quiser em `x-forwarded-for`, e cada proxy só acrescenta no fim. Por
// isso vale a posição contada da direita: o valor mais à esquerda é forjável.

function trustedProxyHops(): number {
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 1);
  return Number.isInteger(hops) && hops >= 1 ? hops : 1;
}

/** Quem o proxy mais externo nosso viu. Sem proxy na frente, o que houver; sem cabeçalho, null. */
export function clientIp(headers: Headers): string | null {
  const chain = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return chain.at(-trustedProxyHops()) ?? chain[0] ?? null;
}

/**
 * Deixa em `x-forwarded-for` só o IP confiável: é dali que o Better Auth lê, e ele pega o valor mais à
 * esquerda. Roda antes do limite de pedidos, que vem antes de qualquer plugin.
 */
export function withClientIp(request: Request): Request {
  const headers = new Headers(request.headers);
  const ip = clientIp(headers);
  if (ip) headers.set("x-forwarded-for", ip);
  else headers.delete("x-forwarded-for");
  return new Request(request, { headers });
}
