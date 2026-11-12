import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import Image from "next/image";
import casalCaminhando from "@/assets/landing/casal-caminhando.webp";
import casalPlanejando from "@/assets/landing/casal-planejando.webp";
import familiaPraia from "@/assets/landing/familia-praia.webp";
import { DEFAULT_LOCALE, LANDING_PATHS, type Locale } from "@/i18n/locales";
import { LandingLocale } from "./landing-locale";
import { ProductPreview } from "./product-preview";
import { Brand } from "@/components/brand";

const OPEN_GRAPH_LOCALE: Record<Locale, string> = {
  "pt-BR": "pt_BR",
  en: "en_US",
  es: "es_ES",
};

/** Título, descrição e os endereços de cada idioma, para a busca achar a versão certa. */
export async function landingMetadata(path: string): Promise<Metadata> {
  const [t, locale] = await Promise.all([getTranslations("landing.meta"), getLocale()]);
  const title = t("title");
  const description = t("description");
  return {
    title: { absolute: title },
    description,
    alternates: {
      canonical: path,
      languages: { ...LANDING_PATHS, "x-default": LANDING_PATHS[DEFAULT_LOCALE] },
    },
    openGraph: {
      title,
      description,
      url: path,
      locale: OPEN_GRAPH_LOCALE[locale],
      type: "website",
      images: [{ url: familiaPraia.src, width: familiaPraia.width, height: familiaPraia.height }],
    },
  };
}

const STEPS = ["family", "month", "decide"] as const;

// Mantenha esta lista fiel ao produto: só marque "Disponível" o que já funciona em produção.
const MODULES = [
  { id: "family", ready: true },
  { id: "cashflow", ready: true },
  { id: "calendar", ready: true },
  { id: "debts", ready: true },
  { id: "reserve", ready: true },
  { id: "investments", ready: true },
  { id: "retirement", ready: true },
  { id: "trips", ready: true },
  { id: "assistant", ready: false },
] as const;

const PROMISES = ["spaces", "bank", "connection", "control"] as const;
const QUESTIONS = ["bank", "who", "invest", "mobile", "ready"] as const;

// Links comuns, e não <Link>: /en e /es fixam o idioma no layout raiz, e a tela seguinte precisa
// montá-lo de novo para seguir o idioma da pessoa.
// Em `/en` e `/es` o idioma ainda não é uma escolha guardada: o link leva, para quem entra sem cookie.
const signInPath = (locale: string) =>
  locale === DEFAULT_LOCALE ? "/entrar" : `/entrar?lang=${locale}`;
const signUpPath = (locale: string) =>
  locale === DEFAULT_LOCALE ? "/cadastro" : `/cadastro?lang=${locale}`;
const TERMS = "/termos";
const PRIVACY = "/privacidade";

function Logo({ light = false }: { light?: boolean }) {
  return <Brand tone={light ? "dark" : "light"} />;
}

const primaryButton =
  "inline-flex min-h-12 items-center justify-center rounded-full bg-peach px-7 font-semibold text-night transition hover:bg-white";

/** A mesma página em `/`, `/en` e `/es`: o idioma vem de `resolveLocale`. */
export async function LandingPage({ home }: { home: string }) {
  const [t, locale] = await Promise.all([getTranslations("landing"), getLocale()]);
  const SIGN_IN = signInPath(locale);
  const SIGN_UP = signUpPath(locale);
  return (
    <div className="bg-sand-50 text-night">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-3"
      >
        {t("skip")}
      </a>

      <section className="relative isolate flex min-h-[92dvh] flex-col overflow-hidden bg-night">
        <div className="absolute inset-y-0 right-0 -z-20 w-full md:w-[74%]">
          <Image
            src={familiaPraia}
            alt={t("hero.imageAlt")}
            fill
            priority
            placeholder="blur"
            sizes="(min-width: 768px) 74vw, 100vw"
            className="object-cover object-[58%_60%]"
          />
        </div>
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-night from-15% via-night/80 via-55% to-night/25 md:bg-gradient-to-r md:from-night md:from-30% md:via-night/70 md:via-50% md:to-transparent md:to-75%" />

        <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
          <a href={home} aria-label={t("nav.home")}>
            <Logo light />
          </a>
          <nav aria-label={t("nav.main")} className="flex items-center gap-1 text-sm text-white">
            <a
              href="#como-funciona"
              className="hidden rounded-full px-3 py-2 hover:underline md:block"
            >
              {t("nav.howItWorks")}
            </a>
            <a href="#modulos" className="hidden rounded-full px-3 py-2 hover:underline md:block">
              {t("nav.inside")}
            </a>
            <a href="#seguranca" className="hidden rounded-full px-3 py-2 hover:underline md:block">
              {t("nav.security")}
            </a>
            <a href={SIGN_IN} className="rounded-full px-3 py-2 hover:underline">
              {t("nav.signIn")}
            </a>
            <a
              href={SIGN_UP}
              className="whitespace-nowrap rounded-full bg-white px-4 py-2 font-semibold text-night hover:bg-peach"
            >
              {t("nav.signUp")}
            </a>
            <LandingLocale compact className="ml-2 hidden md:flex" />
          </nav>
        </header>

        <div
          id="conteudo"
          className="mx-auto mt-auto w-full max-w-6xl px-5 pb-14 pt-24 sm:px-8 md:pb-20"
        >
          <div className="max-w-2xl text-white">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-peach">
              {t("hero.eyebrow")}
            </p>
            <h1 className="mt-4 font-display text-[2.75rem] font-medium leading-[1.05] sm:text-6xl lg:text-7xl">
              {t("hero.title")}
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/90">{t("hero.text")}</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a href={SIGN_UP} className={primaryButton}>
                {t("hero.start")}
              </a>
              <a
                href="#como-funciona"
                className="inline-flex min-h-12 items-center rounded-full border border-white/50 px-6 font-semibold text-white hover:bg-white/10"
              >
                {t("hero.seeHow")}
              </a>
            </div>
            <p className="mt-6 text-sm text-white/85">{t("hero.note")}</p>
            <LandingLocale compact className="mt-4 text-sm text-white md:hidden" />
          </div>
        </div>
      </section>

      <section id="como-funciona" className="scroll-mt-6 px-5 py-20 sm:px-8 md:py-28">
        <div className="mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-2 md:gap-16">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-clay">
              {t("how.eyebrow")}
            </p>
            <h2 className="mt-3 font-display text-4xl font-medium leading-tight sm:text-5xl">
              {t("how.title")}
            </h2>
            <ol className="m-0 mt-10 list-none space-y-8 p-0">
              {STEPS.map((step, index) => (
                <li key={step} className="flex gap-5">
                  <span
                    aria-hidden="true"
                    className="font-display text-3xl font-medium leading-none text-clay"
                  >
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="text-lg font-semibold">{t(`how.steps.${step}.title`)}</h3>
                    <p className="mt-1 leading-relaxed text-stone">{t(`how.steps.${step}.text`)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <Image
            src={casalPlanejando}
            alt={t("how.imageAlt")}
            placeholder="blur"
            sizes="(min-width: 768px) 50vw, 100vw"
            className="h-full max-h-[34rem] w-full rounded-3xl object-cover object-center"
          />
        </div>
      </section>

      <section className="bg-sand-100 px-5 py-20 sm:px-8 md:py-28">
        <div className="mx-auto max-w-4xl">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-4xl font-medium leading-tight sm:text-5xl">
              {t("glance.title")}
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-stone">{t("glance.text")}</p>
          </div>
          <div className="mt-12">
            <ProductPreview />
          </div>
        </div>
      </section>

      <section id="modulos" className="scroll-mt-6 px-5 py-20 sm:px-8 md:py-28">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-clay">
              {t("modules.eyebrow")}
            </p>
            <h2 className="mt-3 font-display text-4xl font-medium leading-tight sm:text-5xl">
              {t("modules.title")}
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-stone">{t("modules.text")}</p>
          </div>
          <ul className="m-0 mt-12 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {MODULES.map((module) => (
              <li
                key={module.id}
                className="flex flex-col rounded-2xl border border-sand-200 bg-white p-5"
              >
                <span
                  className={`self-start rounded-full px-2.5 py-1 text-xs font-semibold ${
                    module.ready ? "bg-pine text-white" : "bg-sand-100 text-stone"
                  }`}
                >
                  {module.ready ? t("modules.available") : t("modules.building")}
                </span>
                <h3 className="mt-4 font-semibold">{t(`modules.items.${module.id}.name`)}</h3>
                <p className="mt-1 text-sm leading-relaxed text-stone">
                  {t(`modules.items.${module.id}.text`)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="bg-pine px-5 py-20 text-white sm:px-8 md:py-28">
        <div className="mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-[2fr_3fr] md:gap-16">
          <Image
            src={casalCaminhando}
            alt={t("retirement.imageAlt")}
            placeholder="blur"
            sizes="(min-width: 768px) 40vw, 100vw"
            className="max-h-[36rem] w-full rounded-3xl object-cover"
          />
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-peach">
              {t("retirement.eyebrow")}
            </p>
            <h2 className="mt-3 font-display text-4xl font-medium leading-tight sm:text-5xl">
              {t("retirement.title")}
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-white/90">{t("retirement.text")}</p>
            <p className="mt-4 text-sm text-white/80">{t("retirement.note")}</p>
          </div>
        </div>
      </section>

      <section id="seguranca" className="scroll-mt-6 px-5 py-20 sm:px-8 md:py-28">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-clay">
              {t("security.eyebrow")}
            </p>
            <h2 className="mt-3 font-display text-4xl font-medium leading-tight sm:text-5xl">
              {t("security.title")}
            </h2>
          </div>
          <ul className="m-0 mt-12 grid list-none gap-x-12 gap-y-10 p-0 md:grid-cols-2">
            {PROMISES.map((promise) => (
              <li key={promise} className="border-t border-sand-200 pt-6">
                <h3 className="text-lg font-semibold">{t(`security.items.${promise}.title`)}</h3>
                <p className="mt-2 leading-relaxed text-stone">
                  {t(`security.items.${promise}.text`)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="bg-sand-100 px-5 py-20 sm:px-8 md:py-28">
        <div className="mx-auto max-w-3xl">
          <h2 className="font-display text-4xl font-medium leading-tight sm:text-5xl">
            {t("faq.title")}
          </h2>
          <div className="mt-10 divide-y divide-sand-200 border-y border-sand-200">
            {QUESTIONS.map((item) => (
              <details key={item} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold [&::-webkit-details-marker]:hidden">
                  {t(`faq.items.${item}.q`)}
                  <span
                    aria-hidden="true"
                    className="text-xl leading-none text-clay transition group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 leading-relaxed text-stone">{t(`faq.items.${item}.a`)}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-night px-5 py-20 text-center text-white sm:px-8 md:py-28">
        <h2 className="mx-auto max-w-3xl font-display text-4xl font-medium leading-tight sm:text-6xl">
          {t("closing.title")}
        </h2>
        <a href={SIGN_UP} className={`${primaryButton} mt-9`}>
          {t("hero.start")}
        </a>
      </section>

      <footer className="bg-night px-5 pb-10 text-sm text-white/75 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 border-t border-white/15 pt-8 md:flex-row md:items-start md:justify-between">
          <Logo light />
          <p className="max-w-2xl leading-relaxed">{t("footer.text")}</p>
          <div className="flex shrink-0 flex-col gap-4">
            <nav aria-label={t("footer.documents")} className="flex flex-col gap-2">
              <a href={TERMS} className="underline">
                {t("footer.terms")}
              </a>
              <a href={PRIVACY} className="underline">
                {t("footer.privacy")}
              </a>
            </nav>
            <LandingLocale />
          </div>
        </div>
      </footer>
    </div>
  );
}
