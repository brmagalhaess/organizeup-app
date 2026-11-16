/** O OrganizeUp de verdade: é o único endereço que um build de loja usa. */
export const PRODUCTION_URL = "https://organizeup.crowntech.com.br";

/**
 * Endereço do OrganizeUp. Em desenvolvimento vem de `EXPO_PUBLIC_API_URL` (o site desta máquina);
 * no build de loja (`__DEV__` falso) é sempre a produção, mesmo que um `.env.local` esquecido aponte
 * para outro lugar: o app publicado nunca fala com um servidor de teste.
 */
export const API_URL = (
  __DEV__ ? (process.env.EXPO_PUBLIC_API_URL ?? PRODUCTION_URL) : PRODUCTION_URL
).replace(/\/$/, "");

/** Igual a `scheme` em app.json e a `MOBILE_APP_ORIGIN` em apps/web/src/lib/auth.ts. */
export const APP_SCHEME = "organizeup";
