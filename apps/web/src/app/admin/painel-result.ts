/** Resposta das ações do painel, mostrada ao lado do botão. */
export interface AdminResult {
  ok: boolean;
  message: string;
}

export const done = (message: string): AdminResult => ({ ok: true, message });
export const failed = (message: string): AdminResult => ({ ok: false, message });
