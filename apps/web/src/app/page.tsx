import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import casalCaminhando from "@/assets/landing/casal-caminhando.webp";
import casalPlanejando from "@/assets/landing/casal-planejando.webp";
import familiaPraia from "@/assets/landing/familia-praia.webp";
import { ProductPreview } from "@/components/landing/product-preview";

const description =
  "Receitas, despesas, dívidas, viagens e aposentadoria conectados no plano da sua família. Dados separados por família, e nada muda sem a sua confirmação.";

export const metadata: Metadata = {
  title: { absolute: "OrganizeUp · O plano financeiro da sua família" },
  description,
  openGraph: {
    title: "OrganizeUp · O plano financeiro da sua família",
    description,
    locale: "pt_BR",
    type: "website",
    images: [{ url: familiaPraia.src, width: familiaPraia.width, height: familiaPraia.height }],
  },
};

const steps = [
  {
    title: "Conte como é a sua família",
    text: "Quem mora com você, onde vocês vivem e o que querem para os próximos anos.",
  },
  {
    title: "Veja o dinheiro do mês",
    text: "Receitas e despesas em um só lugar, separadas entre o que já aconteceu e o que ainda vem.",
  },
  {
    title: "Decida com clareza",
    text: "Cada mudança aparece ligada ao que importa: o mês, a reserva, a viagem e a aposentadoria.",
  },
];

// Mantenha esta lista fiel ao produto: só marque "Disponível" o que já funciona em produção.
const modules = [
  { name: "Família e configurações", text: "Pessoas, cidade e fuso do seu plano.", ready: true },
  {
    name: "Receitas e despesas",
    text: "Lançamentos, categorias e o resumo do mês.",
    ready: true,
  },
  {
    name: "Dívidas e cartões",
    text: "Faturas, parcelas, juros e a melhor ordem para quitar.",
    ready: true,
  },
  { name: "Reserva e patrimônio", text: "Sua segurança e a evolução do que é seu.", ready: false },
  { name: "Investimentos", text: "Carteira, proventos e classes de ativos.", ready: false },
  {
    name: "Aposentadoria",
    text: "Aporte necessário e cenários com premissas claras.",
    ready: false,
  },
  { name: "Viagens e objetivos", text: "Sonhos com data, custo e aporte mensal.", ready: false },
  { name: "Assistente da família", text: "Tira dúvidas e explica o seu plano.", ready: false },
];

const promises = [
  {
    title: "Cada família no seu espaço",
    text: "Os dados ficam separados por família direto no banco de dados, e essa separação é coberta por testes automatizados.",
  },
  {
    title: "Sem senha do seu banco",
    text: "Você informa os lançamentos no próprio OrganizeUp. Não pedimos a senha do seu banco nem acesso à sua conta.",
  },
  {
    title: "Conexão protegida",
    text: "O acesso acontece por conexão segura (HTTPS), e sua senha do OrganizeUp nunca é guardada em texto aberto: ela é protegida por hash.",
  },
  {
    title: "Você no controle",
    text: "O OrganizeUp organiza e explica. Ele não movimenta dinheiro e não indica compra ou venda de investimentos.",
  },
];

const faq = [
  {
    q: "Preciso conectar minha conta do banco?",
    a: "Não. Você registra o que entra e o que sai no próprio OrganizeUp, sem informar senha ou acesso do banco.",
  },
  {
    q: "Quem consegue ver os meus dados?",
    a: "Dentro do sistema, só quem faz parte do espaço da sua família vê esses dados. Cada família fica separada das demais.",
  },
  {
    q: "O OrganizeUp recomenda investimentos?",
    a: "Não. Ele ajuda a organizar e entender o seu plano. Decisões de investimento continuam sendo suas.",
  },
  {
    q: "Funciona no celular?",
    a: "Sim. O sistema foi desenhado primeiro para a tela do celular e funciona direto no navegador, sem instalar nada.",
  },
  {
    q: "Todos os módulos já estão prontos?",
    a: "Ainda não. O OrganizeUp está sendo construído por etapas. Nesta página você vê o que já funciona e o que está em construção.",
  },
];

function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className={`font-display text-xl font-semibold ${light ? "text-white" : "text-night"}`}>
      OrganizeUp
    </span>
  );
}

const primaryButton =
  "inline-flex min-h-12 items-center justify-center rounded-full bg-peach px-7 font-semibold text-night transition hover:bg-white";

export default function Home() {
  return (
    <div className="bg-sand-50 text-night">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-3"
      >
        Pular para o conteúdo
      </a>

      <section className="relative isolate flex min-h-[92dvh] flex-col overflow-hidden bg-night">
        <div className="absolute inset-y-0 right-0 -z-20 w-full md:w-[74%]">
          <Image
            src={familiaPraia}
            alt="Família de mãos dadas, de costas, olhando o mar ao entardecer"
            fill
            priority
            placeholder="blur"
            sizes="(min-width: 768px) 74vw, 100vw"
            className="object-cover object-[58%_60%]"
          />
        </div>
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-night from-15% via-night/80 via-55% to-night/25 md:bg-gradient-to-r md:from-night md:from-30% md:via-night/70 md:via-50% md:to-transparent md:to-75%" />

        <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
          <Link href="/" aria-label="OrganizeUp, início">
            <Logo light />
          </Link>
          <nav aria-label="Principal" className="flex items-center gap-1 text-sm text-white">
            <a
              href="#como-funciona"
              className="hidden rounded-full px-3 py-2 hover:underline md:block"
            >
              Como funciona
            </a>
            <a href="#modulos" className="hidden rounded-full px-3 py-2 hover:underline md:block">
              O que tem dentro
            </a>
            <a href="#seguranca" className="hidden rounded-full px-3 py-2 hover:underline md:block">
              Segurança
            </a>
            <Link href="/entrar" className="rounded-full px-3 py-2 hover:underline">
              Entrar
            </Link>
            <Link
              href="/cadastro"
              className="rounded-full bg-white px-4 py-2 font-semibold text-night hover:bg-peach"
            >
              Criar conta
            </Link>
          </nav>
        </header>

        <div
          id="conteudo"
          className="mx-auto mt-auto w-full max-w-6xl px-5 pb-14 pt-24 sm:px-8 md:pb-20"
        >
          <div className="max-w-2xl text-white">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-peach">
              Finanças · Família · Sonhos · Aposentadoria
            </p>
            <h1 className="mt-4 font-display text-[2.75rem] font-medium leading-[1.05] sm:text-6xl lg:text-7xl">
              Organize o hoje. Dê espaço ao que vem depois.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/90">
              O dinheiro da casa, as viagens que vocês querem fazer e a aposentadoria no mesmo
              plano, em linguagem de gente.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/cadastro" className={primaryButton}>
                Começar meu plano
              </Link>
              <a
                href="#como-funciona"
                className="inline-flex min-h-12 items-center rounded-full border border-white/50 px-6 font-semibold text-white hover:bg-white/10"
              >
                Ver como funciona
              </a>
            </div>
            <p className="mt-6 text-sm text-white/85">
              Sem senha do banco. Dados separados por família.
            </p>
          </div>
        </div>
      </section>

      <section id="como-funciona" className="scroll-mt-6 px-5 py-20 sm:px-8 md:py-28">
        <div className="mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-2 md:gap-16">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-clay">
              Como funciona
            </p>
            <h2 className="mt-3 font-display text-4xl font-medium leading-tight sm:text-5xl">
              Planejar junto, sem planilha e sem briga.
            </h2>
            <ol className="m-0 mt-10 list-none space-y-8 p-0">
              {steps.map((step, index) => (
                <li key={step.title} className="flex gap-5">
                  <span
                    aria-hidden="true"
                    className="font-display text-3xl font-medium leading-none text-clay"
                  >
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="text-lg font-semibold">{step.title}</h3>
                    <p className="mt-1 leading-relaxed text-stone">{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <Image
            src={casalPlanejando}
            alt="Casal conversando na bancada da cozinha, com notebook e tablet"
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
              O mês inteiro em um olhar.
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-stone">
              O que entrou, o que saiu e o que sobrou. Simples de ler, inclusive para quem nunca
              gostou de planilha.
            </p>
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
              O que tem dentro
            </p>
            <h2 className="mt-3 font-display text-4xl font-medium leading-tight sm:text-5xl">
              Um sistema que cresce com o seu plano.
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-stone">
              Estamos construindo por etapas, e mostramos aqui exatamente o que já funciona.
            </p>
          </div>
          <ul className="m-0 mt-12 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {modules.map((module) => (
              <li
                key={module.name}
                className="flex flex-col rounded-2xl border border-sand-200 bg-white p-5"
              >
                <span
                  className={`self-start rounded-full px-2.5 py-1 text-xs font-semibold ${
                    module.ready ? "bg-pine text-white" : "bg-sand-100 text-stone"
                  }`}
                >
                  {module.ready ? "Disponível" : "Em construção"}
                </span>
                <h3 className="mt-4 font-semibold">{module.name}</h3>
                <p className="mt-1 text-sm leading-relaxed text-stone">{module.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="bg-pine px-5 py-20 text-white sm:px-8 md:py-28">
        <div className="mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-[2fr_3fr] md:gap-16">
          <Image
            src={casalCaminhando}
            alt="Casal de idosos de mãos dadas, de costas, caminhando por um jardim"
            placeholder="blur"
            sizes="(min-width: 768px) 40vw, 100vw"
            className="max-h-[36rem] w-full rounded-3xl object-cover"
          />
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-peach">
              Aposentadoria
            </p>
            <h2 className="mt-3 font-display text-4xl font-medium leading-tight sm:text-5xl">
              O futuro também é despesa do mês.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-white/90">
              Aposentadoria não é assunto para depois. O OrganizeUp é pensado para mostrar quanto
              guardar hoje para viver bem amanhã, sem abrir mão da viagem das crianças.
            </p>
            <p className="mt-4 text-sm text-white/80">
              Este módulo está em construção. As projeções vão mostrar sempre as premissas usadas.
            </p>
          </div>
        </div>
      </section>

      <section id="seguranca" className="scroll-mt-6 px-5 py-20 sm:px-8 md:py-28">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-clay">Segurança</p>
            <h2 className="mt-3 font-display text-4xl font-medium leading-tight sm:text-5xl">
              Sua vida financeira merece respeito.
            </h2>
          </div>
          <ul className="m-0 mt-12 grid list-none gap-x-12 gap-y-10 p-0 md:grid-cols-2">
            {promises.map((promise) => (
              <li key={promise.title} className="border-t border-sand-200 pt-6">
                <h3 className="text-lg font-semibold">{promise.title}</h3>
                <p className="mt-2 leading-relaxed text-stone">{promise.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="bg-sand-100 px-5 py-20 sm:px-8 md:py-28">
        <div className="mx-auto max-w-3xl">
          <h2 className="font-display text-4xl font-medium leading-tight sm:text-5xl">
            Perguntas frequentes
          </h2>
          <div className="mt-10 divide-y divide-sand-200 border-y border-sand-200">
            {faq.map((item) => (
              <details key={item.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span
                    aria-hidden="true"
                    className="text-xl leading-none text-clay transition group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 leading-relaxed text-stone">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-night px-5 py-20 text-center text-white sm:px-8 md:py-28">
        <h2 className="mx-auto max-w-3xl font-display text-4xl font-medium leading-tight sm:text-6xl">
          O próximo capítulo começa com uma conversa em casa.
        </h2>
        <Link href="/cadastro" className={`${primaryButton} mt-9`}>
          Começar meu plano
        </Link>
      </section>

      <footer className="bg-night px-5 pb-10 text-sm text-white/75 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 border-t border-white/15 pt-8 md:flex-row md:items-start md:justify-between">
          <Logo light />
          <p className="max-w-2xl leading-relaxed">
            O OrganizeUp é uma ferramenta de organização financeira. Não é banco nem corretora, não
            movimenta dinheiro e não faz recomendação de investimento. Fotos ilustrativas, de bancos
            de imagem; as pessoas retratadas não são clientes.
          </p>
        </div>
      </footer>
    </div>
  );
}
