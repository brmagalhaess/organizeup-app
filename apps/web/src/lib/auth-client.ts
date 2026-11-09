"use client";
import { createAuthClient } from "better-auth/react";
import { organizationClient, twoFactorClient } from "better-auth/client/plugins";
import { ac, roles } from "./permissions";

/** Depois da senha, quem tem o segundo fator ativo cai na tela do código (ADR-0034). */
export const TWO_FACTOR_PATH = "/entrar/codigo";

// Sem `onTwoFactorRedirect`: quem decide a navegação é o formulário de entrar, com o router do Next.
export const authClient = createAuthClient({
  plugins: [organizationClient({ ac, roles }), twoFactorClient()],
});
