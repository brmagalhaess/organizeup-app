/**
 * Limite em memória por chave, em janela fixa. A web é um processo só; depois de um reinício, a
 * contagem recomeça. A chave fica só aqui, nunca vai para log nem para o banco.
 */
export function createRateLimiter({
  limit,
  windowMs,
  maxKeys = 5000,
}: {
  limit: number;
  windowMs: number;
  maxKeys?: number;
}) {
  const windows = new Map<string, { hits: number; resetAt: number }>();
  return function allow(key: string, now = Date.now()): boolean {
    const current = windows.get(key);
    if (!current || current.resetAt <= now) {
      // Chaves sem fim (cabeçalho forjado) não podem crescer sem limite.
      if (windows.size >= maxKeys) windows.clear();
      windows.set(key, { hits: 1, resetAt: now + windowMs });
      return true;
    }
    current.hits += 1;
    return current.hits <= limit;
  };
}
