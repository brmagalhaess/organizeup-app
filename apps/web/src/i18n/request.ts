import { getRequestConfig } from "next-intl/server";
import { LAST_RESORT, messagesFor } from "./messages";
import { resolveLocale } from "./resolve";

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  return {
    locale,
    messages: messagesFor(locale),
    getMessageFallback: () => LAST_RESORT,
    // Só o código: o texto do erro pode trazer valores da tela.
    onError: (error) => console.error("i18n_error", error.code),
  };
});
