/**
 * Route Handler com efeito só aceita pedido da própria página. O cookie da sessão já é SameSite=Lax;
 * isto cobre o resto. Navegador antigo sem o cabeçalho passa, e o cookie continua valendo.
 */
export const sameSite = (request: Request) =>
  (request.headers.get("sec-fetch-site") ?? "same-origin") === "same-origin";
