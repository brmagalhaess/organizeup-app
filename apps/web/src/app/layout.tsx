import type { Metadata, Viewport } from "next";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { Fraunces, Inter } from "next/font/google";
import { AccountTypeProvider } from "@/i18n/account";
import { familyAccountType } from "@/i18n/account-server";
import { FamilyCurrencyProvider } from "@/i18n/money";
import { familyCurrency } from "@/i18n/money-server";
import { IntlProvider } from "@/i18n/provider";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return {
    metadataBase: new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000"),
    title: { default: "OrganizeUp", template: "%s · OrganizeUp" },
    description: t("description"),
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#183c32",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [locale, messages, currency, accountType] = await Promise.all([
    getLocale(),
    getMessages(),
    familyCurrency(),
    familyAccountType(),
  ]);
  return (
    <html lang={locale} className={`${inter.variable} ${fraunces.variable}`}>
      <body className="min-h-dvh font-sans antialiased">
        <IntlProvider locale={locale} messages={messages}>
          <AccountTypeProvider type={accountType}>
            <FamilyCurrencyProvider currency={currency}>{children}</FamilyCurrencyProvider>
          </AccountTypeProvider>
        </IntlProvider>
      </body>
    </html>
  );
}
