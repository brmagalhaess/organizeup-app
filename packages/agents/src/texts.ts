// Tudo o que os agentes escrevem para a família. Cada função devolve o texto em português, gravado em
// `title` e `body` como reserva, e a mesma coisa por chave e valores, que a tela mostra no idioma de quem
// lê (ADR-0020). O teste apps/web/src/i18n/agent-text.test.ts confere que os dois dizem o mesmo. O valor
// sai na moeda principal da família, que vem de quem chama.
import {
  addMonths,
  debtPlanHeadline,
  debtPlanHeadlineMessage,
  formatMoney,
  formatYearMonth,
  message,
  money,
  moneyValue,
  recommendedStrategy,
  sentences,
  type Currency,
  type DebtPlan,
  type GoalPlan,
  type Message,
  type MessageValue,
  type TripSuggestion,
} from "@organizeup/domain";
import { AI_CATEGORY_REASON } from "./suggestions";

export interface AgentText {
  title: string;
  body: string;
  message: Message;
}

export interface ReportText {
  title: string;
  summary: string;
  message: Message;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const reais = moneyValue;
const moneyText = (value: string, currency: Currency) => formatMoney(value, currency);
const month = (value: string): MessageValue => ({ month: value });
const entries = (count: number) => plural(count, "lançamento", "lançamentos");
const quote = (name: string) => `‘${name}’`;
const decimalText = (value: string | number) => String(value).replace(".", ",");
const dateText = (date: string) => date.split("-").reverse().join("/");

// ---------- aportes ----------

export function aporteReservaText(input: {
  amount: string;
  missing: string;
  targetMonths: number;
  /** Meses até fechar. Null quando não há como dizer. */
  months: number | null;
  currency: Currency;
}): AgentText {
  const { amount, missing, targetMonths, months, currency } = input;
  return {
    title: `Guardar ${moneyText(amount, currency)} por mês na reserva de emergência`,
    body:
      `Faltam ${moneyText(missing, currency)} para a reserva de ${targetMonths} meses ` +
      `de gastos essenciais.${months ? ` Com este valor ela fecha em ${months} ${months === 1 ? "mês" : "meses"}.` : ""} ` +
      `Aceitar grava este valor como o quanto guardar por mês na reserva.`,
    message: message("aporteReserva", {
      amount: reais(amount, currency),
      parts: sentences([
        message("frases.reservaFalta", { missing: reais(missing, currency), targetMonths }),
        ...(months ? [message("frases.reservaFecha", { months })] : []),
        message("frases.reservaAceitar"),
      ]),
    }),
  };
}

export function aporteDividaText(input: {
  amount: string;
  debt: string;
  monthlyRate: string;
  currency: Currency;
}): AgentText {
  const { amount, debt, monthlyRate, currency } = input;
  const rate = money(monthlyRate).toDecimalPlaces(2);
  return {
    title: `Pagar ${moneyText(amount, currency)} a mais por mês em ‘${debt}’`,
    body:
      `Essa dívida custa ${rate.toString().replace(".", ",")}% ao mês, ` +
      `mais do que a carteira rende. Quitar antes rende mais que investir. Aceitar registra a ` +
      `decisão; o pagamento extra você faz na tela de dívidas.`,
    message: message("aporteDivida", {
      amount: reais(amount, currency),
      debt,
      rate: { percent: rate.toNumber() },
    }),
  };
}

const STRATEGY_NAME = { avalanche: "maior juro primeiro", snowball: "menor saldo primeiro" };

export function aporteDividaPlanoText(input: {
  amount: string;
  debt: string;
  strategy: keyof typeof STRATEGY_NAME;
  currency: Currency;
}): AgentText {
  const { amount, debt, strategy, currency } = input;
  return {
    title: `Pagar ${moneyText(amount, currency)} a mais por mês em ‘${debt}’`,
    body:
      `Pelo plano de saída (${STRATEGY_NAME[strategy]}), esta é a dívida a atacar agora. ` +
      `Aceitar registra a decisão; o pagamento extra você faz na tela de dívidas.`,
    message: message("aporteDividaPlano", { amount: reais(amount, currency), debt, strategy }),
  };
}

type RetirementDetail =
  | { kind: "incompleto" }
  | { kind: "fecha"; targetYear: number }
  | { kind: "falta"; targetYear: number; required: string | null; year: number | null };

function retirementDetail(detail: RetirementDetail, amount: string, currency: Currency) {
  if (detail.kind === "incompleto")
    return {
      text: "Complete o plano de aposentadoria para ver em que ano a carteira fecha.",
      message: message("frases.aposentadoriaIncompleta"),
    };
  if (detail.kind === "fecha")
    return {
      text: `Com este valor a carteira fecha em ${detail.targetYear}.`,
      message: message("frases.aposentadoriaFecha", { year: detail.targetYear }),
    };
  const { targetYear, required, year } = detail;
  return {
    text:
      `Para fechar em ${targetYear} seria preciso ${required ? moneyText(required, currency) : "mais"} por mês; ` +
      `com ${moneyText(amount, currency)} a carteira fecha em ${year ?? "mais de 60 anos"}.`,
    message: message("frases.aposentadoriaPreciso", {
      targetYear,
      required: required
        ? reais(required, currency)
        : { message: message("frases.aposentadoriaMais") },
      amount: reais(amount, currency),
      year: year ?? { message: message("frases.aposentadoriaMaisDe60") },
    }),
  };
}

export function aporteInvestimentoText(
  amount: string,
  kind: RetirementDetail,
  currency: Currency,
): AgentText {
  const detail = retirementDetail(kind, amount, currency);
  return {
    title: `Guardar ${moneyText(amount, currency)} por mês para a aposentadoria`,
    body: `${detail.text} Aceitar grava este valor como o quanto guardar por mês no plano.`,
    message: message("aporteInvestimento", {
      amount: reais(amount, currency),
      detail: { message: detail.message },
    }),
  };
}

export type ReminderKind = "sem_yield" | "sem_yield_simples" | "sem_ano" | "outro";

export function reminderText(kind: ReminderKind): AgentText & { href: string } {
  switch (kind) {
    case "sem_yield":
      return {
        title: "Informe o rendimento anual da carteira",
        body:
          "Ou registre os proventos recebidos. Sem isso o assistente não consegue calcular quanto " +
          "precisa ter investido para viver dos rendimentos.",
        href: "/app/aposentadoria",
        message: message("lembreteRendimento"),
      };
    case "sem_yield_simples":
      return {
        title: "Informe o rendimento anual da carteira",
        body:
          "Sem isso o assistente não consegue calcular quanto precisa ter investido para viver dos " +
          "rendimentos.",
        href: "/app/aposentadoria",
        message: message("lembreteRendimentoSimples"),
      };
    case "sem_ano":
      return {
        title: "Diga em que ano querem parar de trabalhar",
        body:
          "Com o ano, o assistente calcula quanto guardar por mês para a carteira pagar as contas " +
          "até lá.",
        href: "/app/completar",
        message: message("lembreteAno"),
      };
    default:
      return {
        title: "Complete seu plano de aposentadoria",
        body:
          "Informe a renda que você quer por mês ou registre seus gastos. Com isso o assistente " +
          "estima quanto guardar por mês.",
        href: "/app/completar",
        message: message("lembretePlano"),
      };
  }
}

// ---------- categorias ----------

const RULE_REASON = "A regra conhece o estabelecimento";
const SEEN_REASON = /^O assistente já viu este estabelecimento em (.+)$/;
const FIXED_REASONS: Record<string, Message> = {
  [RULE_REASON]: message("frases.motivoRegra"),
  [AI_CATEGORY_REASON]: message("frases.motivoAssistente"),
  "Nomes iguais ou um contém o outro": message("frases.motivoNomesIguais"),
  "Nome casa com as palavras de outra categoria": message("frases.motivoPalavras"),
};

/** Motivo por chave. Vale para o de hoje e para o gravado numa sugestão antiga. */
function reasonValue(reason: string): MessageValue {
  const fixed = FIXED_REASONS[reason];
  if (fixed) return { message: fixed };
  const seen = SEEN_REASON.exec(reason)?.[1];
  if (seen) return { message: message("frases.motivoVisto", { name: { category: seen } }) };
  return reason;
}

export function categoriaMovidaText(input: {
  count: number;
  from: string;
  to: string;
  reason: string;
}): AgentText {
  const { count, from, to, reason } = input;
  return {
    title: `Movemos ${entries(count)} de ${quote(from)} para ${quote(to)}`,
    body:
      `${reason}. Se não fizer sentido, use Desfazer: o assistente devolve os lançamentos ` +
      `e não mexe mais neles.`,
    message: message("categoriaMovida", {
      count,
      from: { category: from },
      to: { category: to },
      reason: reasonValue(reason),
    }),
  };
}

export function categoriaFusaoText(input: {
  from: string;
  to: string;
  reason?: string | undefined;
}): AgentText {
  const { from, to, reason } = input;
  const names = { from: { category: from }, to: { category: to } };
  return {
    title: `Juntamos ${quote(from)} com ${quote(to)}`,
    body:
      `${reason ? `${reason}. ` : ""}Lançamentos, previsões e compras foram para ${quote(to)}, ` +
      `e ${quote(from)} foi arquivada. Se não fizer sentido, use Desfazer.`,
    message: message("categoriaFusao", {
      ...names,
      parts: sentences([
        ...(reason ? [message("frases.motivo", { reason: reasonValue(reason) })] : []),
        message("frases.fusaoFeita", names),
      ]),
    }),
  };
}

export const categoriaSemPistaText = (): AgentText => ({
  title: "Sem categoria clara",
  body: "O assistente não soube classificar este estabelecimento e tenta de novo em 30 dias.",
  message: message("categoriaSemPista"),
});

// ---------- investimentos ----------

export const proventoExcluidoText = (): AgentText => ({
  title: "Provento automático excluído",
  body: "Você excluiu este provento, e ele não volta sozinho.",
  message: message("proventoExcluido"),
});

const STOCK_EVENT = /^(Desdobramento|Grupamento|Bonificação)(?: de (.+))?$/;
const STOCK_EVENT_KIND: Record<string, string> = {
  Desdobramento: "desdobramento",
  Grupamento: "grupamento",
  Bonificação: "bonificacao",
};

/** A nota do evento vem da coleta em português: nome do evento e fator. */
function stockEventValue(
  note: string,
  key: "frases.eventoAcoes" | "frases.eventoAcoesNaFrase",
): MessageValue {
  const match = STOCK_EVENT.exec(note);
  if (!match) return note;
  return {
    message: message(key, { kind: STOCK_EVENT_KIND[match[1]!]!, factor: match[2] ?? "none" }),
  };
}

export function quantidadeConferirText(input: {
  ticker: string;
  note: string;
  comDate: string;
}): AgentText {
  const { ticker, note, comDate } = input;
  return {
    title: `Confira a quantidade de ${ticker}`,
    body:
      `${note} com data-com em ${dateText(comDate)}. Há ` +
      `operação registrada depois dessa data, que pode já estar com a quantidade nova, então ` +
      `não ajustamos sozinhos. Se a quantidade não bater com a da corretora, corrija as ` +
      `operações: até lá, o valor deste investimento pode ficar errado.`,
    message: message("quantidadeConferir", {
      ticker,
      event: stockEventValue(note, "frases.eventoAcoes"),
      date: { date: comDate },
    }),
  };
}

const quantityText = (value: string) =>
  money(value).toDecimalPlaces(8).toString().replace(".", ",");

export function quantidadeAjustadaText(input: {
  ticker: string;
  note: string;
  comDate: string;
  before: string;
  after: string;
}): AgentText {
  const { ticker, note, comDate, before, after } = input;
  return {
    title: `Quantidade de ${ticker} ajustada`,
    body:
      `${ticker}: ${note.charAt(0).toLowerCase()}${note.slice(1)} em ` +
      `${dateText(comDate)}. A quantidade foi de ${quantityText(before)} para ` +
      `${quantityText(after)}. O valor total não muda, e suas operações ficam como você ` +
      `registrou.`,
    message: message("quantidadeAjustada", {
      ticker,
      event: stockEventValue(note, "frases.eventoAcoesNaFrase"),
      date: { date: comDate },
      before: { quantity: before },
      after: { quantity: after },
    }),
  };
}

export const valorSemInformarText = (label: string): AgentText => ({
  title: `Atualize o valor de ${label}`,
  body: `${label} ainda não tem valor atual informado; o patrimônio e o plano usam o custo de compra.`,
  message: message("valorSemInformar", { label }),
});

export const valorAntigoText = (label: string, days: number): AgentText => ({
  title: `Atualize o valor de ${label}`,
  body:
    `O último valor de ${label} é de há ${plural(days, "dia", "dias")}. Sem um valor recente, ` +
    `o patrimônio e o plano de aposentadoria ficam defasados.`,
  message: message("valorAntigo", { label, days }),
});

export function classeForaDaMetaText(input: {
  assetClass: string;
  label: string;
  percent: number;
  target: number;
}): AgentText {
  const { assetClass, label, percent, target } = input;
  const above = percent > target;
  return {
    title: `${label}: ${percent}% da carteira, meta de ${target}%`,
    body:
      `A fatia de ${label.toLowerCase()} está ${above ? "acima" : "abaixo"} ` +
      `da meta que você definiu. É só um aviso: o assistente não indica o que comprar ou vender.`,
    message: message("classeForaDaMeta", {
      label: { message: message("frases.classe", { assetClass }) },
      labelInSentence: { message: message("frases.classeNaFrase", { assetClass }) },
      percent: { percent },
      target: { percent: target },
      direction: above ? "acima" : "abaixo",
    }),
  };
}

export const proventosConferirText = (tickers: string[]): AgentText => ({
  title: "Proventos para conferir no extrato",
  body:
    `${tickers.join(", ")}: há proventos que não lançamos sozinhos porque o imposto depende de ` +
    `dados que não temos, como a data do crédito ou o titular. Confira no extrato e lance em ` +
    `Proventos.`,
  message: message("proventosConferir", { tickers: tickers.join(", ") }),
});

export function mercadoDiaText(input: {
  prices: number;
  labels: string[];
  created: number;
  upcoming: number;
  upcomingNet: string;
  adjusted: number;
  removed: number;
  currency: Currency;
}): AgentText {
  const { prices, labels, created, upcoming, upcomingNet, adjusted, removed, currency } = input;
  const shown = labels.slice(0, 8).join(", ");
  const more = labels.length > 8 ? "sim" : "nao";
  const lines: Array<{ text: string; message: Message }> = [];
  if (prices > 0)
    lines.push({
      text: `${plural(prices, "preço atualizado", "preços atualizados")} (${shown}${labels.length > 8 ? " e outros" : ""})`,
      message: message("frases.mercadoPrecos", { count: prices, labels: shown, more }),
    });
  if (created > 0)
    lines.push({
      text: plural(created, "provento lançado", "proventos lançados"),
      message: message("frases.mercadoProventos", { count: created }),
    });
  if (upcoming > 0)
    lines.push({
      text: `${moneyText(upcomingNet, currency)} a receber em ${plural(upcoming, "pagamento", "pagamentos")}`,
      message: message("frases.mercadoAReceber", {
        amount: reais(upcomingNet, currency),
        count: upcoming,
      }),
    });
  if (adjusted > 0)
    lines.push({
      text: plural(adjusted, "provento corrigido", "proventos corrigidos"),
      message: message("frases.mercadoCorrigidos", { count: adjusted }),
    });
  if (removed > 0)
    lines.push({
      text: plural(removed, "provento retirado", "proventos retirados"),
      message: message("frases.mercadoRetirados", { count: removed }),
    });
  return {
    title: "Cotações e proventos atualizados",
    body: `${lines.map((line) => line.text).join("; ")}. Se desfizer, os proventos não voltam sozinhos; o preço volta com a próxima cotação nova.`,
    message: message("mercadoDia", {
      parts: sentences(
        lines.map((line) => line.message),
        "; ",
      ),
    }),
  };
}

// ---------- metas ----------

export function metaNotaParcelaText(from: string, to: string, currency: Currency) {
  return {
    text: `Parcela ajustada de ${moneyText(from, currency)} para ${moneyText(to, currency)}.`,
    message: message("frases.notaParcelaAjustada", {
      from: reais(from, currency),
      to: reais(to, currency),
    }),
  };
}

export const metaNotaContaText = () => ({
  text: "Escolha a conta de onde sai a parcela para ela entrar no calendário.",
  message: message("frases.notaEscolhaConta"),
});

/** A nota do plano, por chave: uma frase só, porque a coluna guarda uma chave. */
export const metaNotaMessage = (items: Message[]) =>
  message("frases.notaMeta", { parts: sentences(items) });

export function metaText(input: {
  name: string;
  desiredMonth: string | null;
  plan: Pick<GoalPlan, "monthly" | "end" | "note" | "noteMessages">;
  extraMonthly: string | null;
  currency: Currency;
}): AgentText {
  const { name, desiredMonth, plan, extraMonthly, currency } = input;
  const parts: string[] = [];
  const items: Message[] = [];
  if (plan.monthly && plan.end) {
    parts.push(
      `Hoje dá para guardar ${moneyText(plan.monthly, currency)} por mês para ‘${name}’, o que termina em ` +
        `${formatYearMonth(plan.end)}.`,
    );
    items.push(
      message("frases.metaGuardar", {
        amount: reais(plan.monthly, currency),
        name,
        end: month(plan.end),
      }),
    );
  } else {
    parts.push(`Hoje não sobra orçamento para ‘${name}’.`);
    items.push(message("frases.metaSemEspaco", { name }));
  }
  if (desiredMonth && extraMonthly) {
    parts.push(
      `Para conquistar em ${formatYearMonth(desiredMonth)} seria preciso ${moneyText(extraMonthly, currency)} a mais por mês.`,
    );
    items.push(
      message("frases.metaPrecisa", {
        desired: month(desiredMonth),
        extra: reais(extraMonthly, currency),
      }),
    );
  } else if (desiredMonth && plan.note) {
    parts.push(plan.note);
    items.push(...plan.noteMessages);
  }
  if (plan.end) {
    parts.push(
      `Aceitar muda a data desejada para ${formatYearMonth(plan.end)}; ou reduza o valor, pause outra meta ou aumente o que guarda.`,
    );
    items.push(message("frases.metaAceitar", { end: month(plan.end) }));
  } else {
    parts.push("Reduza o valor, adie a data ou pause outra meta para abrir espaço.");
    items.push(message("frases.metaReduza"));
  }
  const key = plan.monthly ? "metaForaDoPrazo" : "metaSemOrcamento";
  return {
    title: plan.monthly
      ? `A meta ‘${name}’ não cabe no prazo`
      : `Hoje não sobra para a meta ‘${name}’`,
    body: parts.join(" "),
    message: message(key, { name, parts: sentences(items) }),
  };
}

// ---------- viagens ----------

export function viagemText(item: TripSuggestion, travelers: number, currency: Currency): AgentText {
  const saveUntil = addMonths(item.month, -1);
  const parts = [
    `Em ${formatYearMonth(item.month)} · ${plural(item.days, "dia", "dias")} para ` +
      `${plural(travelers, "pessoa", "pessoas")}.`,
    `Cerca de ${moneyText(item.total, currency)} (${moneyText(item.perPerson, currency)} por pessoa): passagem ` +
      `${moneyText(item.estimated.passagem, currency)}, hospedagem ${moneyText(item.estimated.hospedagem, currency)}, ` +
      `alimentação ${moneyText(item.estimated.alimentacao, currency)} e transporte ` +
      `${moneyText(item.estimated.transporte, currency)}; passeios ficam por sua conta.`,
    item.fits
      ? `Guarde ${moneyText(item.monthlyToSave, currency)} por mês até ${formatYearMonth(saveUntil)}.`
      : `Pede ${moneyText(item.monthlyToSave, currency)} por mês, mais do que sobra para viagens hoje.`,
    item.note,
    `Valores aproximados pela nossa tabela de custos (confiança ${item.confidence}). Confira ` +
      `passagens e hospedagem antes de fechar. Fonte: ${item.source}`,
  ].filter(Boolean);
  return {
    title: `Que tal ${item.name} em ${formatYearMonth(item.month)}?`,
    body: parts.join(" "),
    message: message("viagem", {
      name: item.name,
      month: month(item.month),
      parts: sentences([
        message("frases.viagemQuando", {
          month: month(item.month),
          days: item.days,
          people: travelers,
        }),
        message("frases.viagemCusto", {
          total: reais(item.total, currency),
          perPerson: reais(item.perPerson, currency),
          flight: reais(item.estimated.passagem, currency),
          lodging: reais(item.estimated.hospedagem, currency),
          food: reais(item.estimated.alimentacao, currency),
          transport: reais(item.estimated.transporte, currency),
        }),
        item.fits
          ? message("frases.viagemGuarde", {
              amount: reais(item.monthlyToSave, currency),
              until: month(saveUntil),
            })
          : message("frases.viagemPede", { amount: reais(item.monthlyToSave, currency) }),
        ...item.noteMessages,
        message("frases.viagemFonte", { confidence: item.confidence, source: item.source }),
      ]),
    }),
  };
}

// ---------- assistente ----------

export const assistenteAporteText = ({
  reserve,
  amount,
  currency,
}: {
  reserve: boolean;
  amount: string;
  currency: Currency;
}): AgentText => ({
  title: reserve ? "Guardar na reserva todo mês" : "Guardar para a aposentadoria todo mês",
  body: `Combinado na conversa com o assistente: ${moneyText(amount, currency)} por mês.`,
  message: message(reserve ? "assistenteReserva" : "assistenteAposentadoria", {
    amount: reais(amount, currency),
  }),
});

export const assistenteDataMetaText = (input: { name: string; month: string }): AgentText => ({
  title: `Nova data para ${input.name}`,
  body: `Mudar o mês desejado de ${input.name} para ${input.month}.`,
  // Vai como foi digitado, com o ano primeiro, igual ao texto de reserva.
  message: message("assistenteDataMeta", { name: input.name, month: input.month }),
});

export const assistenteMetaText = ({
  name,
  amount,
  currency,
}: {
  name: string;
  amount: string;
  currency: Currency;
}): AgentText => ({
  title: `Criar a meta ${name}`,
  body: `Meta de ${moneyText(amount, currency)}, proposta na conversa com o assistente.`,
  message: message("assistenteMeta", { name, amount: reais(amount, currency) }),
});

/** O modelo já escreve o lembrete no idioma de quem conversa: a chave só diz que não é português. */
export const assistenteLembreteText = (title: string, body: string): AgentText => ({
  title,
  body,
  message: message("assistenteLembrete", { title, body }),
});

// ---------- notificações ----------

export interface NotificationLine {
  type: "alteracao" | "fusao" | "resumo";
  count: number;
  total: string;
  merchant?: string;
  fromNames?: string[];
  toName?: string;
  changes?: number;
}

const notificationEntries = (count: number, total: string, currency: Currency): MessageValue => ({
  message: message("frases.notificacaoLancamentos", { count, sum: reais(total, currency) }),
});

/** O que a linha de Notificações diz. A etiqueta de categoria nova é da tela, ao lado do título. */
export function notificationText(line: NotificationLine, currency: Currency): AgentText {
  const { count, total } = line;
  const sum = moneyText(total, currency);
  const detail = notificationEntries(count, total, currency);
  if (line.type === "resumo") {
    const changes = line.changes ?? 0;
    return {
      title: `E mais ${plural(changes, "mudança", "mudanças")} nesta noite`,
      body: `${entries(count)}, ${sum}. Tudo está em Sugestões, com Desfazer.`,
      message: message("notificacaoResumo", { changes, detail }),
    };
  }
  const fromNames = line.fromNames ?? [];
  const toName = line.toName ?? "";
  const names = { from: { categories: fromNames }, to: { category: toName } };
  const title = `De ${fromNames.join(", ")} para ${toName}`;
  if (line.type === "fusao")
    return {
      title,
      body: `Categorias juntadas: ${entries(count)}, ${sum}.`,
      message: message("notificacaoFusao", { ...names, detail }),
    };
  const merchant = line.merchant ?? "";
  return {
    title,
    body: `${merchant}: ${entries(count)}, ${sum}.`,
    message: message("notificacaoMudanca", { ...names, merchant, detail }),
  };
}

// ---------- relatórios do dia ----------

const stamp = (day: string): MessageValue => ({ date: day });

export interface InvestimentosReportInput {
  day: string;
  empty: boolean;
  total: string;
  dividends12: string;
  yield12: number | null;
  stale: number;
  /** Mudanças do mercado aplicadas hoje. Zero: a frase não entra. */
  applied: number;
  prices: number;
  created: number;
  stockEvents: number;
  upcoming: number;
  upcomingNet: string;
  next: { month: string; amount: string } | null;
  currency: Currency;
}

export function investimentosReportText(input: InvestimentosReportInput): ReportText {
  const { day, empty, total, dividends12, yield12, stale, currency } = input;
  const title = `Investimentos em ${day}`;
  if (empty)
    return {
      title,
      summary: "Nenhum investimento cadastrado ainda.",
      message: message("relatorioInvestimentosVazio", { day: stamp(day) }),
    };
  const { applied, prices, created, stockEvents, upcoming, upcomingNet, next } = input;
  const yieldText = yield12 !== null ? ` (${decimalText(yield12)}% ao ano)` : "";
  const wallet = { total: reais(total, currency), dividends: reais(dividends12, currency) };
  const items: Message[] = [
    yield12 === null
      ? message("frases.relCarteira", wallet)
      : message("frases.relCarteiraRende", { ...wallet, percent: { percent: yield12 } }),
    message("frases.relValorAtualizar", { count: stale }),
    ...(applied > 0 ? [message("frases.relAtualizadoHoje", { prices, created })] : []),
    ...(stockEvents > 0 ? [message("frases.relQuantidades", { count: stockEvents })] : []),
    ...(upcoming > 0
      ? [message("frases.relAReceber", { amount: reais(upcomingNet, currency) })]
      : []),
    ...(next
      ? [
          message("frases.relPrevisao", {
            month: month(next.month),
            amount: reais(next.amount, currency),
          }),
        ]
      : []),
  ];
  return {
    title,
    summary:
      `Carteira de ${moneyText(total, currency)}; ${moneyText(dividends12, currency)} em proventos nos ` +
      `últimos 12 meses${yieldText}. ` +
      `${plural(stale, "investimento", "investimentos")} com valor para atualizar.` +
      (applied > 0
        ? ` Atualizado sozinho hoje: ${plural(prices, "preço", "preços")} ` +
          `e ${plural(created, "provento novo", "proventos novos")}.`
        : "") +
      (stockEvents > 0
        ? ` ${plural(stockEvents, "quantidade ajustada", "quantidades ajustadas")} por ` +
          `desdobramento, grupamento ou bonificação.`
        : "") +
      (upcoming > 0 ? ` A receber: ${moneyText(upcomingNet, currency)}.` : "") +
      (next
        ? ` Previsão para ${formatYearMonth(next.month)}: ${moneyText(next.amount, currency)} em proventos.`
        : ""),
    message: message("relatorioInvestimentos", { day: stamp(day), parts: sentences(items) }),
  };
}

export interface AposentadoriaReportInput {
  day: string;
  surplus: string;
  available: string;
  /** Null: previsto pela renda e pelas despesas recorrentes. */
  baseMonths: number | null;
  reserve: string;
  debt: string;
  retirement: string;
  goals: string;
  trips: string;
  /** Null: plano incompleto. */
  plan: { targetIncome: string; coverage: number } | null;
  currency: Currency;
}

export function aposentadoriaReportText(input: AposentadoriaReportInput): ReportText {
  const { day, surplus, available, baseMonths, reserve, debt, retirement, goals, trips } = input;
  const { plan, currency } = input;
  const basisText =
    baseMonths === null
      ? "previsto pela renda e pelas despesas recorrentes"
      : `base de ${baseMonths} ${baseMonths === 1 ? "mês" : "meses"}`;
  const summary =
    `Sobra típica de ${moneyText(surplus, currency)} por mês (${basisText}); ` +
    `${moneyText(available, currency)} para dividir depois da folga. Divisão: ${moneyText(reserve, currency)} ` +
    `na reserva, ${moneyText(debt, currency)} em dívidas caras, ${moneyText(retirement, currency)} ` +
    `para a aposentadoria, ${moneyText(goals, currency)} para metas e ` +
    `${moneyText(trips, currency)} para viagens.` +
    (plan
      ? ` Renda alvo ${moneyText(plan.targetIncome, currency)}; a carteira já cobre ${plan.coverage}% do que falta.`
      : " O plano de aposentadoria ainda está incompleto.");
  return {
    title: `Divisão do que sobra em ${day}`,
    summary,
    message: message("relatorioAposentadoria", {
      day: stamp(day),
      parts: sentences([
        message("frases.relSobra", {
          surplus: reais(surplus, currency),
          available: reais(available, currency),
          basis: {
            message:
              baseMonths === null
                ? message("frases.relSobraBasePrevista")
                : message("frases.relSobraBaseMeses", { months: baseMonths }),
          },
          reserve: reais(reserve, currency),
          debt: reais(debt, currency),
          retirement: reais(retirement, currency),
          goals: reais(goals, currency),
          trips: reais(trips, currency),
        }),
        plan
          ? message("frases.relPlanoCoberto", {
              target: reais(plan.targetIncome, currency),
              coverage: { percent: plan.coverage },
            })
          : message("frases.relPlanoIncompleto"),
      ]),
    }),
  };
}

/** Relatório de uma frase só, com o dia no título. */
const fixedReport = (
  title: string,
  summary: string,
  key: "relatorioViagens" | "relatorioMetas" | "relatorioDividas",
  day: string,
  sentence: Message,
): ReportText => ({
  title,
  summary,
  message: message(key, { day: stamp(day), parts: sentences([sentence]) }),
});

export type ViagensReportInput =
  | { day: string; kind: "sem_pedido" | "sem_divisao" | "sem_pessoas" | "fora_do_brasil" }
  | {
      day: string;
      kind: "sugestoes";
      count: number;
      fits: number;
      budget: string;
      shortfall: string | null;
      currency: Currency;
    };

export function viagensReportText(input: ViagensReportInput): ReportText {
  const { day } = input;
  const title = `Viagens em ${day}`;
  if (input.kind !== "sugestoes") {
    const { text, sentence } = {
      sem_pedido: {
        text: "A família não pediu sugestões de viagem. Diga quantas viagens por ano em Configurações › Plano.",
        sentence: message("frases.relViagensSemPedido"),
      },
      sem_divisao: {
        text: "Sem a divisão do que sobra hoje; as sugestões ficam para a próxima rodada.",
        sentence: message("frases.relViagensSemDivisao"),
      },
      sem_pessoas: {
        text: "Cadastre as pessoas da família para receber sugestões de viagem.",
        sentence: message("frases.relViagensSemPessoas"),
      },
      fora_do_brasil: {
        text: "A tabela de destinos é em reais e para quem sai do Brasil: sem sugestões de viagem nesta moeda.",
        sentence: message("frases.relViagensForaDoBrasil"),
      },
    }[input.kind];
    return fixedReport(title, text, "relatorioViagens", day, sentence);
  }
  const { count, fits, budget, shortfall, currency } = input;
  if (count === 0)
    return fixedReport(
      title,
      `Nenhum destino da tabela cabe em ${moneyText(budget, currency)} por mês para viagens.`,
      "relatorioViagens",
      day,
      message("frases.relViagensNenhuma", { budget: reais(budget, currency) }),
    );
  const notAll = fits < count;
  return {
    title,
    summary:
      `${plural(count, "viagem sugerida", "viagens sugeridas")} com ` +
      `${moneyText(budget, currency)} por mês para viagens` +
      (notAll ? "; nem todas cabem no orçamento de hoje." : ".") +
      (shortfall
        ? ` As viagens já marcadas pedem ${moneyText(shortfall, currency)} a mais por mês.`
        : ""),
    message: message("relatorioViagens", {
      day: stamp(day),
      parts: sentences([
        message("frases.relViagensSugeridas", {
          count,
          budget: reais(budget, currency),
          notAll: notAll ? "sim" : "nao",
        }),
        ...(shortfall
          ? [message("frases.relViagensPedem", { amount: reais(shortfall, currency) })]
          : []),
      ]),
    }),
  };
}

export type MetasReportInput =
  | { day: string; kind: "nenhuma" | "sem_divisao" }
  | {
      day: string;
      kind: "plano";
      goals: number;
      budget: string;
      planned: number;
      onTime: number;
      noRoom: number;
      currency: Currency;
    };

export function metasReportText(input: MetasReportInput): ReportText {
  const { day } = input;
  const title = `Metas em ${day}`;
  if (input.kind !== "plano") {
    const { text, sentence } = {
      nenhuma: {
        text: "Nenhuma meta cadastrada ainda.",
        sentence: message("frases.relMetasNenhuma"),
      },
      sem_divisao: {
        text: "Sem a divisão do que sobra hoje; o plano das metas foi mantido.",
        sentence: message("frases.relMetasSemDivisao"),
      },
    }[input.kind];
    return fixedReport(title, text, "relatorioMetas", day, sentence);
  }
  const { goals, budget, planned, onTime, noRoom, currency } = input;
  return {
    title,
    summary:
      `${plural(goals, "meta", "metas")}; ${moneyText(budget, currency)} por mês para ` +
      `metas. ${plural(planned, "meta com plano", "metas com plano")}, ${onTime} dentro do prazo, ` +
      `${plural(noRoom, "sem espaço no orçamento", "sem espaço no orçamento")}.`,
    message: message("relatorioMetasPlano", {
      day: stamp(day),
      goals,
      budget: reais(budget, currency),
      planned,
      onTime,
      noRoom,
    }),
  };
}

export const dividasVaziasReportText = (day: string): ReportText =>
  fixedReport(
    `Dívidas em ${day}`,
    "Nenhuma dívida em aberto.",
    "relatorioDividas",
    day,
    message("frases.relDividasNenhuma"),
  );

export function dividasReportText(
  day: string,
  plan: DebtPlan,
  previous: DebtPlan | null,
  currency: Currency,
): ReportText {
  const best = recommendedStrategy(plan);
  const parts = [
    `${debtPlanHeadline(plan, currency)}.`,
    `${plural(best.attack.length, "dívida", "dívidas")}, ${moneyText(plan.totalBalance, currency)} no total.`,
  ];
  const items: Message[] = [
    debtPlanHeadlineMessage(plan, currency),
    message("frases.relDividasTotal", {
      count: best.attack.length,
      total: reais(plan.totalBalance, currency),
    }),
  ];
  if (best.focus) {
    parts.push(`Comece por ‘${best.focus.name}’.`);
    items.push(message("frases.relDividasComece", { name: best.focus.name }));
  }
  if (money(plan.extra).isZero()) {
    parts.push("Hoje não sobra valor extra para as dívidas.");
    items.push(message("frases.relDividasSemExtra"));
  }
  const before = previous ? recommendedStrategy(previous).payoffMonth : null;
  if (before && best.payoffMonth && before !== best.payoffMonth) {
    parts.push(
      `A quitação mudou de ${formatYearMonth(before)} para ${formatYearMonth(best.payoffMonth)}.`,
    );
    items.push(
      message("frases.relDividasMudou", {
        from: month(before),
        to: month(best.payoffMonth),
      }),
    );
  }
  if (plan.signals.length > 0) {
    parts.push(`${plural(plan.signals.length, "ponto de atenção", "pontos de atenção")}.`);
    items.push(message("frases.relDividasAtencao", { count: plan.signals.length }));
  }
  return {
    title: `Plano das dívidas em ${day}`,
    summary: parts.join(" "),
    message: message("relatorioDividasPlano", { day: stamp(day), parts: sentences(items) }),
  };
}
