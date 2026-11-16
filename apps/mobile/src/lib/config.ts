/** Endereço do OrganizeUp. Vem do build (`EXPO_PUBLIC_API_URL`); sem ele, a produção. */
export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL ?? "https://organizeup.crowntech.com.br"
).replace(/\/$/, "");

/** Igual a `scheme` em app.json e a `MOBILE_APP_ORIGIN` em apps/web/src/lib/auth.ts. */
export const APP_SCHEME = "organizeup";
