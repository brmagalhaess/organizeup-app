import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import * as texts from "@organizeup/agents";
import {
  categoryReportMessage,
  dailyCategoryReport,
  debtPlanHeadlineMessage,
  importReport,
  ROW_MESSAGE_KEYS,
  SENTENCE_MESSAGE_KEYS,
  type DebtPlan,
  type Message,
  type TripSuggestion,
} from "@organizeup/domain";
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import ptBR from "../../messages/pt-BR.json";
import { agentSentence, agentText } from "./agent-text";
import type { Locale } from "./locales";

const repo = path.resolve(import.meta.dirname, "../../../..");
const CATALOGS = { "pt-BR": ptBR, en, es };
const OTHER: Locale[] = ["en", "es"];

const trip: TripSuggestion = {
  destinationId: "lisboa",
  name: "Lisboa",
  month: "2027-05",
  days: 7,
  personIds: ["p1"],
  estimated: {
    passagem: "4000.00",
    hospedagem: "3000.00",
    alimentacao: "1000.00",
    transporte: "500.00",
  },
  total: "8500.00",
  perPerson: "4250.00",
  monthlyToSave: "850.00",
  fits: true,
  confidence: "media",
  source: "Tabela interna, consulta 10/2026",
  note: "maio é boa época para Lisboa.",
  noteMessages: [
    {
      key: "frases.viagemBoaEpoca",
      params: { month: { monthName: 5 }, name: "Lisboa" },
    },
  ],
};

const debtPlan = (over: Record<string, unknown> = {}) => {
  const strategy = {
    payoffMonth: "2028-03",
    saved: "1200.00",
    attack: [{ id: "d1" }, { id: "d2" }],
    focus: { name: "Cartão loja" },
    thisMonth: [],
    ...over,
  };
  return {
    totalBalance: "9000.00",
    extra: "0.00",
    recommended: "avalanche",
    avalanche: strategy,
    snowball: strategy,
    signals: [{}],
  } as unknown as DebtPlan;
};

/** Uma linha por caminho: juntas, passam por toda chave que os agentes gravam. */
const SAMPLES: Array<{ title: string; body: string; message: Message }> = [
  texts.aporteReservaText({
    currency: "BRL",
    amount: "300.00",
    missing: "1500.00",
    targetMonths: 6,
    months: 5,
  }),
  texts.aporteDividaText({
    currency: "BRL",
    amount: "200.00",
    debt: "Cartão loja",
    monthlyRate: "4.5",
  }),
  texts.aporteDividaPlanoText({
    currency: "BRL",
    amount: "200.00",
    debt: "Cartão loja",
    strategy: "avalanche",
  }),
  texts.aporteDividaPlanoText({
    currency: "BRL",
    amount: "200.00",
    debt: "Cartão loja",
    strategy: "snowball",
  }),
  texts.aporteInvestimentoText("400.00", { kind: "incompleto" }, "BRL"),
  texts.aporteInvestimentoText("400.00", { kind: "fecha", targetYear: 2045 }, "BRL"),
  texts.aporteInvestimentoText(
    "400.00",
    {
      kind: "falta",
      targetYear: 2045,
      required: "900.00",
      year: 2052,
    },
    "BRL",
  ),
  texts.aporteInvestimentoText(
    "400.00",
    {
      kind: "falta",
      targetYear: 2045,
      required: null,
      year: null,
    },
    "BRL",
  ),
  texts.reminderText("sem_yield"),
  texts.reminderText("sem_yield_simples"),
  texts.reminderText("sem_ano"),
  texts.reminderText("outro"),
  texts.categoriaMovidaText({
    count: 3,
    from: "Outras despesas",
    to: "Mercado",
    reason: "A regra conhece o estabelecimento",
  }),
  texts.categoriaMovidaText({
    count: 1,
    from: "Outras despesas",
    to: "Pets",
    reason: "O assistente já viu este estabelecimento em Pets",
  }),
  texts.categoriaMovidaText({
    count: 2,
    from: "Outras despesas",
    to: "Feira",
    reason: "O assistente reconheceu o estabelecimento pela descrição do extrato",
  }),
  texts.categoriaFusaoText({
    from: "Mercadinho",
    to: "Mercado",
    reason: "Nomes iguais ou um contém o outro",
  }),
  texts.categoriaFusaoText({
    from: "Feira",
    to: "Mercado",
    reason: "Nome casa com as palavras de outra categoria",
  }),
  texts.categoriaFusaoText({ from: "Feira", to: "Mercado" }),
  texts.categoriaSemPistaText(),
  texts.proventoExcluidoText(),
  texts.quantidadeConferirText({
    ticker: "PETR4",
    note: "Desdobramento de 1:2",
    comDate: "2026-10-30",
  }),
  texts.quantidadeConferirText({ ticker: "PETR4", note: "Bonificação", comDate: "2026-10-30" }),
  texts.quantidadeAjustadaText({
    ticker: "PETR4",
    note: "Grupamento de 10:1",
    comDate: "2026-10-30",
    before: "100",
    after: "10.5",
  }),
  texts.valorSemInformarText("CDB Banco"),
  texts.valorAntigoText("CDB Banco", 45),
  texts.classeForaDaMetaText({ assetClass: "acao", label: "Ações", percent: 70, target: 40 }),
  texts.classeForaDaMetaText({
    assetClass: "fii",
    label: "Fundos imobiliários",
    percent: 5,
    target: 30,
  }),
  texts.proventosConferirText(["PETR4", "VALE3"]),
  texts.mercadoDiaText({
    currency: "BRL",
    prices: 2,
    labels: ["PETR4", "VALE3"],
    created: 1,
    upcoming: 2,
    upcomingNet: "90.00",
    adjusted: 1,
    removed: 3,
  }),
  texts.mercadoDiaText({
    currency: "BRL",
    prices: 9,
    labels: ["A", "B", "C", "D", "E", "F", "G", "H", "I"],
    created: 0,
    upcoming: 0,
    upcomingNet: "0.00",
    adjusted: 0,
    removed: 0,
  }),
  texts.metaText({
    currency: "BRL",
    name: "Carro",
    desiredMonth: "2027-06",
    plan: { monthly: "500.00", end: "2028-01", note: "", noteMessages: [] },
    extraMonthly: "120.00",
  }),
  texts.metaText({
    currency: "BRL",
    name: "Carro",
    desiredMonth: "2027-06",
    plan: {
      monthly: "500.00",
      end: "2028-01",
      note: "Não cabe no orçamento até junho de 2027; termina em janeiro de 2028.",
      noteMessages: [
        {
          key: "frases.notaNaoCabe",
          params: { desired: { month: "2027-06" }, end: { month: "2028-01" } },
        },
      ],
    },
    extraMonthly: null,
  }),
  texts.metaText({
    currency: "BRL",
    name: "Carro",
    desiredMonth: null,
    plan: { monthly: null, end: null, note: "", noteMessages: [] },
    extraMonthly: null,
  }),
  texts.viagemText(trip, 2, "BRL"),
  texts.viagemText({ ...trip, fits: false, confidence: "baixa" }, 1, "BRL"),
  texts.assistenteAporteText({ currency: "BRL", reserve: true, amount: "150.00" }),
  texts.assistenteAporteText({ currency: "BRL", reserve: false, amount: "150.00" }),
  texts.assistenteDataMetaText({ name: "Carro", month: "2027-06" }),
  texts.assistenteMetaText({ currency: "BRL", name: "Carro", amount: "20000.00" }),
  texts.assistenteLembreteText("Check the fund", "Review it on Friday."),
].map((item) => ({ title: item.title, body: item.body, message: item.message }));

const report = ({ title, summary, message }: texts.ReportText) => ({
  title,
  body: summary,
  message,
});

const REPORTS = [
  report(
    texts.investimentosReportText({
      currency: "BRL",
      day: "2026-10-31",
      empty: true,
      total: "0.00",
      dividends12: "0.00",
      yield12: null,
      stale: 0,
      applied: 0,
      prices: 0,
      created: 0,
      stockEvents: 0,
      upcoming: 0,
      upcomingNet: "0.00",
      next: null,
    }),
  ),
  report(
    texts.investimentosReportText({
      currency: "BRL",
      day: "2026-10-31",
      empty: false,
      total: "50000.00",
      dividends12: "1800.00",
      yield12: 3.6,
      stale: 2,
      applied: 3,
      prices: 2,
      created: 1,
      stockEvents: 1,
      upcoming: 1,
      upcomingNet: "40.00",
      next: { month: "2026-12", amount: "150.00" },
    }),
  ),
  report(
    texts.investimentosReportText({
      currency: "BRL",
      day: "2026-10-31",
      empty: false,
      total: "50000.00",
      dividends12: "0.00",
      yield12: null,
      stale: 1,
      applied: 0,
      prices: 0,
      created: 0,
      stockEvents: 0,
      upcoming: 0,
      upcomingNet: "0.00",
      next: null,
    }),
  ),
  report(
    texts.aposentadoriaReportText({
      currency: "BRL",
      day: "2026-10-31",
      surplus: "1000.00",
      available: "900.00",
      baseMonths: 3,
      reserve: "100.00",
      debt: "200.00",
      retirement: "300.00",
      goals: "200.00",
      trips: "100.00",
      plan: { targetIncome: "8000.00", coverage: 12 },
    }),
  ),
  report(
    texts.aposentadoriaReportText({
      currency: "BRL",
      day: "2026-10-31",
      surplus: "1000.00",
      available: "900.00",
      baseMonths: null,
      reserve: "100.00",
      debt: "200.00",
      retirement: "300.00",
      goals: "200.00",
      trips: "100.00",
      plan: null,
    }),
  ),
  report(texts.viagensReportText({ day: "2026-10-31", kind: "sem_pedido" })),
  report(texts.viagensReportText({ day: "2026-10-31", kind: "sem_divisao" })),
  report(texts.viagensReportText({ day: "2026-10-31", kind: "sem_pessoas" })),
  report(
    texts.viagensReportText({
      day: "2026-10-31",
      kind: "sugestoes",
      currency: "BRL",
      count: 0,
      fits: 0,
      budget: "300.00",
      shortfall: null,
    }),
  ),
  report(
    texts.viagensReportText({
      day: "2026-10-31",
      kind: "sugestoes",
      currency: "BRL",
      count: 2,
      fits: 1,
      budget: "300.00",
      shortfall: "80.00",
    }),
  ),
  report(texts.metasReportText({ day: "2026-10-31", kind: "nenhuma" })),
  report(texts.metasReportText({ day: "2026-10-31", kind: "sem_divisao" })),
  report(
    texts.metasReportText({
      day: "2026-10-31",
      kind: "plano",
      currency: "BRL",
      goals: 3,
      budget: "400.00",
      planned: 2,
      onTime: 1,
      noRoom: 1,
    }),
  ),
  report(texts.viagensReportText({ day: "2026-10-31", kind: "fora_do_brasil" })),
  report(texts.dividasVaziasReportText("2026-10-31")),
  report(
    texts.dividasReportText("2026-10-31", debtPlan(), debtPlan({ payoffMonth: "2028-05" }), "BRL"),
  ),
  report(
    texts.dividasReportText("2026-10-31", debtPlan({ saved: "0.00", focus: null }), null, "BRL"),
  ),
  report(texts.dividasReportText("2026-10-31", debtPlan({ payoffMonth: null }), null, "BRL")),
];

const imported = importReport(
  [
    { kind: "despesa", amount: "10.00", category: "Mercado", source: "memoria", corrected: true },
    { kind: "despesa", amount: "20.00", category: "Lazer", source: "palavra", corrected: false },
    { kind: "receita", amount: "30.00", category: "", source: "revisar", corrected: false },
  ],
  ["Feira"],
  { start: "2026-10-01", end: "2026-10-31" },
);
const reviewed = dailyCategoryReport({
  reviewed: 12,
  moved: 3,
  merges: 1,
  created: ["Feira"],
  day: "2026-10-31",
  ia: { groups: 4, moved: 2, created: ["Pets"], skipped: 1 },
});

const NOTIFICATIONS = [
  texts.notificationText(
    {
      type: "alteracao",
      merchant: "MERCADO X",
      count: 2,
      total: "80.00",
      fromNames: ["Outras despesas"],
      toName: "Mercado",
    },
    "BRL",
  ),
  texts.notificationText(
    {
      type: "fusao",
      count: 0,
      total: "0.00",
      fromNames: ["Mercadinho"],
      toName: "Mercado",
    },
    "BRL",
  ),
  texts.notificationText({ type: "resumo", changes: 3, count: 7, total: "120.00" }, "BRL"),
];

describe("família fora do real", () => {
  const row = texts.aporteReservaText({
    currency: "USD",
    amount: "300.00",
    missing: "1500.00",
    targetMonths: 6,
    months: 5,
  });

  it("o texto de reserva sai na moeda da família", () => {
    expect(row.title).toContain("US$");
    expect(`${row.title}${row.body}`).not.toContain("R$");
  });

  it("os valores crus levam a moeda, e a tela formata em qualquer idioma", () => {
    expect(row.message.params?.["amount"]).toEqual({ money: "300.00", currency: "USD" });
    const shown = agentText(
      {
        title: row.title,
        body: row.body,
        messageKey: row.message.key,
        messageParams: row.message.params ?? null,
      },
      "en",
    );
    expect(shown.title).toContain("$300.00");
    expect(shown.body).toContain("$1,500.00");
  });
});

/** Toda frase dentro de uma mensagem. */
function keysOf(message: Message): string[] {
  const inner = Object.values(message.params ?? {}).flatMap((value) => {
    if (typeof value !== "object") return [];
    if ("message" in value) return keysOf(value.message);
    if ("messages" in value) return value.messages.flatMap(keysOf);
    return [];
  });
  return [message.key, ...inner];
}

const stored = (item: { title: string; body: string; message: Message }) => ({
  title: item.title,
  body: item.body,
  messageKey: item.message.key,
  messageParams: (item.message.params ?? null) as Record<string, unknown> | null,
});

const ALL = [
  ...SAMPLES,
  ...REPORTS,
  ...NOTIFICATIONS,
  { title: imported.title, body: imported.summary, message: imported.message },
  { title: reviewed.title, body: reviewed.summary, message: reviewed.message },
];

/** Frases que só existem dentro de um rascunho de plano do domínio. */
const FROM_DOMAIN: Message[] = [
  { key: "frases.notaConquistada" },
  { key: "frases.notaPausada" },
  { key: "frases.notaSemOrcamento" },
  { key: "frases.notaSemOrcamentoReduza" },
  { key: "frases.notaLonga", params: { amount: { money: "10.00" } } },
  { key: "frases.notaDataPassou", params: { end: { month: "2027-01" } } },
  { key: "frases.notaComeca", params: { name: "Carro" } },
  { key: "frases.viagemGuardeMais", params: { amount: { money: "50.00" } } },
  { key: "frases.viagemCasamento" },
  { key: "frases.relImportacaoDesfeita" },
  { key: "frases.motivo", params: { reason: "Motivo" } },
  texts.metaNotaContaText().message,
  texts.metaNotaParcelaText("100.00", "120.00", "BRL").message,
  texts.metaNotaMessage([{ key: "frases.notaConquistada" }]),
  debtPlanHeadlineMessage(debtPlan({ payoffMonth: null })),
];

describe("catálogo de mensagens", () => {
  it.each(Object.entries(CATALOGS))("%s tem toda chave de linha, com título e corpo", (_, json) => {
    for (const key of ROW_MESSAGE_KEYS) {
      expect(json.agentes, key).toHaveProperty(`${key}.title`);
      expect(json.agentes, key).toHaveProperty(`${key}.body`);
    }
  });

  it.each(Object.entries(CATALOGS))("%s tem toda frase", (_, json) => {
    const sentences = json.agentes.frases as Record<string, string>;
    for (const key of SENTENCE_MESSAGE_KEYS) {
      expect(typeof sentences[key.replace("frases.", "")], key).toBe("string");
    }
  });

  it("o catálogo não guarda chave que ninguém grava", () => {
    const { frases, ...rows } = ptBR.agentes;
    expect(Object.keys(rows).sort()).toEqual([...ROW_MESSAGE_KEYS].sort());
    expect(
      Object.keys(frases)
        .map((key) => `frases.${key}`)
        .sort(),
    ).toEqual([...SENTENCE_MESSAGE_KEYS].sort());
  });

  it("toda chave gravada pelos agentes aparece aqui e existe nos três idiomas", () => {
    const used = new Set([...ALL.map((item) => item.message), ...FROM_DOMAIN].flatMap(keysOf));
    expect([...ROW_MESSAGE_KEYS, ...SENTENCE_MESSAGE_KEYS].filter((key) => !used.has(key))).toEqual(
      [],
    );
  });

  it("nenhum agente escreve chave fora da lista", () => {
    const source = (folder: string): string[] =>
      readdirSync(path.resolve(repo, folder)).flatMap((name) => {
        const file = `${folder}/${name}`;
        if (statSync(path.resolve(repo, file)).isDirectory()) return source(file);
        return name.endsWith(".ts") ? [readFileSync(path.resolve(repo, file), "utf8")] : [];
      });
    const code = [...source("packages/agents/src"), ...source("packages/domain/src")].join("\n");
    const known = new Set<string>([...ROW_MESSAGE_KEYS, ...SENTENCE_MESSAGE_KEYS]);
    const written = [...code.matchAll(/\bmessage\("([^"]+)"/g)].map((match) => match[1]!);
    expect(written.length).toBeGreaterThan(50);
    expect(written.filter((key) => !known.has(key))).toEqual([]);
  });
});

describe("texto por chave", () => {
  it.each(ALL.map((item) => [item.message.key, item] as const))(
    "%s em português diz o mesmo que o texto gravado",
    (key, item) => {
      const shown = agentText(stored(item), "pt-BR");
      expect(shown.translated).toBe(true);
      // Notificação e título de relatório têm outro desenho na tela; o resto é igual, letra por letra.
      const isNotification = key.startsWith("notificacao");
      if (!isNotification) expect(shown.body).toBe(item.body);
      if (!isNotification && !key.startsWith("relatorio")) expect(shown.title).toBe(item.title);
    },
  );

  it.each(ALL.map((item) => [item.message.key, item] as const))(
    "%s sai traduzido em inglês e em espanhol",
    (key, item) => {
      for (const locale of OTHER) {
        const shown = agentText(stored(item), locale);
        expect(shown.translated, locale).toBe(true);
        expect(shown.title, locale).not.toContain("{");
        expect(shown.body, locale).not.toContain("{");
        if (key === "assistenteLembrete") continue;
        expect(`${shown.title} ${shown.body}`, locale).not.toMatch(
          /\b(lançamento|lançamentos|Aceitar|você|família|por mês|não)\b/,
        );
      }
    },
  );

  it("a mesma linha sai diferente para duas pessoas da mesma família", () => {
    const row = stored(
      texts.aporteReservaText({
        currency: "BRL",
        amount: "1234.50",
        missing: "1500.00",
        targetMonths: 6,
        months: 1,
      }),
    );
    expect(agentText(row, "pt-BR").title).toContain("Guardar R$ 1.234,50 por mês");
    expect(agentText(row, "en").title).toBe("Save R$1,234.50 a month in your emergency fund");
    expect(agentText(row, "es").title).toContain("1234,50");
    expect(agentText(row, "es").body).toContain("1 mes");
  });

  it("nome padrão de categoria sai traduzido, e nome digitado fica como está", () => {
    const row = stored(
      texts.categoriaMovidaText({
        count: 2,
        from: "Outras despesas",
        to: "Feira do bairro",
        reason: "A regra conhece o estabelecimento",
      }),
    );
    expect(agentText(row, "en").title).toBe(
      "We moved 2 entries from ‘Other expenses’ to ‘Feira do bairro’",
    );
    expect(agentText(row, "es").title).toBe(
      "Movimos 2 movimientos de ‘Otros gastos’ a ‘Feira do bairro’",
    );
  });

  it("valores saem no formato do idioma", () => {
    const quantity = stored(
      texts.quantidadeAjustadaText({
        ticker: "PETR4",
        note: "Grupamento de 10:1",
        comDate: "2026-10-30",
        before: "100",
        after: "10.5",
      }),
    );
    expect(agentText(quantity, "en").body).toContain("10/30/2026");
    expect(agentText(quantity, "en").body).toContain("from 100 to 10.5");
    expect(agentText(quantity, "en").body).toContain("reverse split of 10:1");
    expect(agentText(quantity, "es").body).toContain("de 100 a 10,5");
    const rate = stored(
      texts.aporteDividaText({
        currency: "BRL",
        amount: "200.00",
        debt: "Loja",
        monthlyRate: "4.5",
      }),
    );
    expect(agentText(rate, "en").body).toContain("costs 4.5% a month");
  });

  it("relatório aparece traduzido para uma pessoa e em português para outra", () => {
    const row = stored({
      title: imported.title,
      body: imported.summary,
      message: imported.message,
    });
    expect(agentText(row, "pt-BR").body).toBe(imported.summary);
    expect(agentText(row, "en").body).toContain("1 from family memory");
    expect(agentText(row, "es").body).toContain("por la memoria de la familia");
  });

  it("notificação aparece traduzida para uma pessoa e em português para outra", () => {
    const row = stored(NOTIFICATIONS[0]!);
    expect(agentText(row, "pt-BR").title).toBe("Outras despesas → Mercado");
    expect(agentText(row, "pt-BR").body).toContain("MERCADO X: 2 lançamentos, R$");
    expect(agentText(row, "en").title).toBe("Other expenses → Groceries");
    expect(agentText(row, "en").body).toBe("MERCADO X: 2 entries, R$80.00");
    expect(agentText(row, "es").body).toContain("MERCADO X: 2 movimientos");
  });

  it("relatório do dia com a etapa de IA soma as duas partes", () => {
    const message = categoryReportMessage(reviewed.data, "2026-10-31");
    const shown = agentText(
      { title: "", body: "", messageKey: message.key, messageParams: message.params ?? null },
      "en",
    );
    expect(shown.body).toContain("From the statement description: 2 entries moved.");
    expect(shown.title).toBe("Categories reviewed on 10/31/2026");
  });
});

describe("linha sem chave", () => {
  const old = { title: "Texto antigo", body: "Corpo antigo" };

  it("mostra o texto gravado", () => {
    expect(agentText(old, "en")).toEqual({ ...old, translated: false });
    expect(agentText({ ...old, messageKey: null }, "es")).toEqual({ ...old, translated: false });
  });

  it("chave que esta versão não conhece mostra o texto gravado", () => {
    expect(agentText({ ...old, messageKey: "chaveNova" }, "en")).toEqual({
      ...old,
      translated: false,
    });
  });

  it("valor faltando ou fora do formato mostra o texto gravado", () => {
    expect(agentText({ ...old, messageKey: "aporteReserva" }, "en").translated).toBe(false);
    expect(
      agentText(
        { ...old, messageKey: "aporteReserva", messageParams: { amount: { x: 1 }, parts: "a" } },
        "en",
      ).translated,
    ).toBe(false);
  });
});

describe("nota do plano da meta", () => {
  const note = texts.metaNotaMessage([
    { key: "frases.notaConquistada" },
    texts.metaNotaParcelaText("100.00", "120.00", "BRL").message,
  ]);

  it("sai no idioma de quem lê", () => {
    expect(agentSentence("Meta conquistada.", note.key, note.params, "en")).toBe(
      "Goal reached. Installment adjusted from R$100.00 to R$120.00.",
    );
  });

  it("sem chave, fica o texto gravado", () => {
    expect(agentSentence("Meta conquistada.", null, null, "en")).toBe("Meta conquistada.");
  });
});
