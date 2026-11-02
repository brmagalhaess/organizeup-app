import { getRequestConfig } from "next-intl/server";
import { familyAccountType } from "./account-server";
import { LAST_RESORT, messagesFor } from "./messages";
import { familyCurrency } from "./money-server";
import { resolveLocale } from "./resolve";

export default getRequestConfig(async () => {
  const [locale, currency, accountType] = await Promise.all([
    resolveLocale(),
    familyCurrency(),
    familyAccountType(),
  ]);
  return {
    locale,
    messages: messagesFor(locale, currency, accountType),
    getMessageFallback: () => LAST_RESORT,
    // Só o código: o texto do erro pode trazer valores da tela.
    onError: (error) => console.error("i18n_error", error.code),
  };
});
