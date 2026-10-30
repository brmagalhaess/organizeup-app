/** Valida o id do convite vindo da URL. Ele entra em redirecionamentos, então só aceita UUID. */
export function inviteId(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

export const ROLE_LABEL: Record<string, string> = {
  owner: "Responsável",
  adult: "Adulto",
  child: "Criança",
  viewer: "Só leitura",
};

/** O que cada papel pode fazer, nas palavras de quem convida. */
export const ROLE_HINT: Record<string, string> = {
  adult: "pode ver e alterar os dados da família",
  viewer: "pode ver, mas não altera nada",
};
