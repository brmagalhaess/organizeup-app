// Limpeza de dados por módulo (ADR-0034). Aqui só a regra: quais módulos existem e o que um puxa junto.
// O apagar em si fica em @organizeup/db (`wipeHouseholdData`), que segue esta mesma lista.

export const WIPE_SCOPES = [
  "lancamentos",
  "cartoes",
  "renda",
  "investimentos",
  "dividas",
  "metas",
  "viagens",
  "aposentadoria",
  "patrimonio",
  "agenda",
  "importacoes",
  "relatorios",
  "contas",
] as const;

export type WipeScope = (typeof WIPE_SCOPES)[number];

/**
 * O que não dá para apagar sozinho: contas e categorias são referenciadas por quase tudo, então limpar
 * "contas" leva junto os módulos que apontam para elas. O resto se resolve apagando filhos antes dos pais
 * ou soltando a referência (parcela paga sem o lançamento, bem sem a dívida, meta sem o evento).
 */
export const WIPE_REQUIRES: Readonly<Partial<Record<WipeScope, readonly WipeScope[]>>> = {
  contas: ["lancamentos", "cartoes", "renda", "dividas", "metas", "patrimonio"],
};

export const isWipeScope = (value: unknown): value is WipeScope =>
  typeof value === "string" && (WIPE_SCOPES as readonly string[]).includes(value);

/** Fecha a escolha: inclui o que cada módulo escolhido exige, na ordem canônica de `WIPE_SCOPES`. */
export function expandWipeScopes(selected: Iterable<WipeScope>): WipeScope[] {
  const chosen = new Set<WipeScope>();
  const add = (scope: WipeScope) => {
    if (chosen.has(scope)) return;
    chosen.add(scope);
    for (const required of WIPE_REQUIRES[scope] ?? []) add(required);
  };
  for (const scope of selected) add(scope);
  return WIPE_SCOPES.filter((scope) => chosen.has(scope));
}
