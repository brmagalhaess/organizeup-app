import "server-only";
import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { getAuth } from "./auth";

export type TwoFactorCheck = "ok" | "nao_ativado" | "codigo_vazio" | "codigo_invalido";

const CODE_SHAPE = /^[0-9]{6}$|^[A-Za-z0-9-]{8,16}$/;

/**
 * Confere o segundo fator antes de uma ação que não volta (ADR-0034): apagar a conta, limpar dados.
 * Com a sessão aberta, `verifyTOTP` do Better Auth só valida o código e devolve a mesma sessão, sem
 * criar outra. Código de reserva também vale, e é consumido. Quem não ativou não passa: a tela manda
 * ativar primeiro.
 */
export async function verifySecondFactor(input: {
  user: { twoFactorEnabled?: boolean | null };
  code: string;
}): Promise<TwoFactorCheck> {
  if (!input.user.twoFactorEnabled) return "nao_ativado";
  const code = input.code.replace(/\s+/g, "");
  if (!code) return "codigo_vazio";
  if (!CODE_SHAPE.test(code)) return "codigo_invalido";
  const auth = getAuth();
  const requestHeaders = await headers();
  try {
    if (/^[0-9]{6}$/.test(code)) {
      await auth.api.verifyTOTP({ headers: requestHeaders, body: { code } });
    } else {
      await auth.api.verifyBackupCode({ headers: requestHeaders, body: { code } });
    }
    return "ok";
  } catch (error) {
    if (error instanceof APIError) return "codigo_invalido";
    throw error;
  }
}
