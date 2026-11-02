export type View = "confirmed" | "already" | "other" | "expired" | "invalid" | "maintenance";

/** `verified` é null sem sessão. O endereço pode ser digitado: a sessão desmente o que ele disser. */
export function viewFor(error: unknown, state: unknown, verified: boolean | null): View {
  if (error === "MAINTENANCE") return "maintenance";
  if (error) {
    if (verified) return "already";
    return error === "TOKEN_EXPIRED" ? "expired" : "invalid";
  }
  // Neutra: não afirma nada sobre a conta aberta, e por isso pode vir antes do que a sessão desmentiria.
  if (state === "outra-conta") return "other";
  if (verified === false) return "invalid";
  if (state === "confirmado") return "confirmed";
  return state === "ja-confirmado" || verified ? "already" : "invalid";
}
