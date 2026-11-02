// Texto que o sistema gravou em português e que a família vê como dado: nomes padrão de categoria e de
// conta, e descrições geradas ("Fatura Nubank", "Meta: Carro (1/10)"). Nada é reescrito no banco: a tela
// traduz só o que é exatamente o padrão. O que a família digitou fica como está. É a função única para
// isso; vale no servidor e no navegador, com `getTranslations("sistema")` ou `useTranslations("sistema")`.
import { CARD_CATEGORY, CONTRIBUTION_CATEGORY } from "@organizeup/domain";

/** Nome gravado em português → chave em `sistema.nomes`. Só o nome exato conta. */
const NAME_KEYS: Readonly<Record<string, string>> = {
  Salário: "salario",
  "Trabalho autônomo": "autonomo",
  "Aluguel recebido": "aluguelRecebido",
  Rendimentos: "rendimentos",
  "Outras receitas": "outrasReceitas",
  Reembolsos: "reembolsos",
  Moradia: "moradia",
  Mercado: "mercado",
  "Luz, água e internet": "contas",
  Saúde: "saude",
  Educação: "educacao",
  Transporte: "transporte",
  Lazer: "lazer",
  Assinaturas: "assinaturas",
  Compras: "compras",
  "Outras despesas": "outrasDespesas",
  "Cartão de crédito": "cartao",
  "Dívidas e empréstimos": "dividas",
  "Metas e objetivos": "metas",
  "Aportes e investimentos": "aportes",
  Restaurantes: "restaurantes",
  Pets: "pets",
  "Tarifas bancárias": "tarifas",
  "Impostos e taxas": "impostos",
  Seguros: "seguros",
  "Cuidados pessoais": "cuidados",
  Academia: "academia",
  Viagens: "viagens",
  "Conta principal": "contaPrincipal",
  "Sem categoria": "semCategoria",
};

/** Só o texto padrão muda: o idioma e a chave vêm do catálogo de quem chama. */
type Translate = (key: string, values?: Record<string, string>) => string;
/** Aceita o `t` tipado de `next-intl`, que só conhece as chaves do grupo. */
type AnyTranslate = (key: never, values?: never) => string;

/** O que a tela sabe sobre a linha. O texto sozinho não diz quem o escreveu. */
export interface DescriptionOrigin {
  /** Nome gravado da categoria: "Fatura da luz" digitada não está em Cartão de crédito. */
  category?: string | null | undefined;
  /** Previsão da fatura: ainda não tem lançamento, então a categoria não diz. */
  bill?: boolean;
  /** O evento do calendário nasceu de uma viagem. */
  trip?: boolean;
}

const GOAL_ENTRY = /^Meta: (.+) \((\d+)\/(\d+)\)$/;
const TRIP = /^Viagem: (.+)$/;
const BILL = /^Fatura (.+)$/;
const CONTRIBUTION = /^Aporte em (.+)$/;
const WITHDRAWAL = /^Resgate de (.+)$/;
const WITH_SOURCE = [
  { key: "ferias", pattern: /^Férias · (.+)$/ },
  { key: "decimoPrimeira", pattern: /^13º, 1ª parcela · (.+)$/ },
  { key: "decimoSegunda", pattern: /^13º, 2ª parcela · (.+)$/ },
  { key: "decimoUnico", pattern: /^13º salário · (.+)$/ },
];

function description(text: string, t: Translate, origin: DescriptionOrigin): string {
  if (text === "Aniversário de casamento") return t("descricoes.casamento");
  const goal = GOAL_ENTRY.exec(text);
  if (goal) {
    const [, name, number, total] = goal as unknown as [string, string, string, string];
    return t("descricoes.meta", { name, number, total });
  }
  for (const { key, pattern } of WITH_SOURCE) {
    const name = pattern.exec(text)?.[1];
    if (name) return t(`descricoes.${key}`, { name });
  }
  const trip = origin.trip ? TRIP.exec(text)?.[1] : undefined;
  if (trip) return t("descricoes.viagem", { name: trip });
  if (origin.bill || origin.category === CARD_CATEGORY) {
    const name = BILL.exec(text)?.[1];
    if (name) return t("descricoes.fatura", { name });
  }
  if (origin.category === CONTRIBUTION_CATEGORY) {
    const contribution = CONTRIBUTION.exec(text)?.[1];
    if (contribution) return t("descricoes.aporte", { name: contribution });
    const withdrawal = WITHDRAWAL.exec(text)?.[1];
    if (withdrawal) return t("descricoes.resgate", { name: withdrawal });
  }
  return text;
}

/** As duas traduções de texto do sistema, no idioma de `t`. */
export function systemTextOf(translate: AnyTranslate) {
  const t = translate as unknown as Translate;
  return {
    /** Categoria ou conta: traduz só enquanto o nome for exatamente o padrão. */
    name(name: string): string {
      const key = NAME_KEYS[name];
      return key ? t(`nomes.${key}`) : name;
    },
    description(text: string, origin: DescriptionOrigin = {}): string {
      return description(text, t, origin);
    },
  };
}

export type SystemText = ReturnType<typeof systemTextOf>;

/** Nomes padrão conhecidos, para o teste conferir o mapa contra o catálogo. */
export const SYSTEM_NAMES: Readonly<Record<string, string>> = NAME_KEYS;
