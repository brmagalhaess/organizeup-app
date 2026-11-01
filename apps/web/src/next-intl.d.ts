// Chaves e idiomas conferidos pelo TypeScript: `t("chave.que.nao.existe")` não compila.
import type { Locale } from "./i18n/locales";
import type ptBR from "../messages/pt-BR.json";

declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof ptBR;
  }
}
