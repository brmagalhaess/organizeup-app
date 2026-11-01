// Tipos do `household_reports.data` por `kind`. O período dos agentes diários é o dia (AAAA-MM-DD).
// São `type` (não `interface`) para caberem em `Record<string, unknown>` da coluna jsonb.
import type {
  Allocation,
  DebtPlan,
  DividendPlan,
  GoalPlan,
  Message,
  ReportCategorias,
  SurplusBasis,
  SurplusResult,
  TripSuggestion,
} from "@organizeup/domain";

export type ReportInvestimentos = {
  total: string;
  cost: string;
  /** Proventos líquidos de 12 meses sobre o valor da carteira, em % (uma casa). Null sem carteira. */
  yield12: number | null;
  dividends12: string;
  byMonth: Array<{ month: string; net: string }>;
  /** Ids dos investimentos sem cotação automática com preço de mais de 30 dias (ou sem preço). */
  stale: string[];
  /** Proventos previstos por mês, somados os ativos. */
  forecast: Array<{ month: string; amount: string }>;
  /** O que a atualização automática fez hoje (ADR-0017). */
  market: {
    prices: number;
    created: number;
    adjusted: number;
    removed: number;
    /** Já lançados pela família. */
    skippedFamily: number;
    /** Ativos com provento fora por imposto incerto. */
    skippedTax: number;
    /** Desdobramentos, grupamentos e bonificações aplicados. */
    stockEvents: number;
  };
  /** Líquido dos proventos anunciados com pagamento depois de hoje. */
  upcomingNet: string;
};

/** Excedente usado na divisão, com a base de onde veio. */
export type ReportSurplus = {
  result: SurplusResult;
  /** `previsto` quando não há histórico e o valor veio de renda − previsões. */
  basis: SurplusBasis | "previsto";
  /** Excedente que entrou na conta (antes da folga). */
  surplus: string;
  /** Depois da folga de 10%: o que foi dividido. */
  available: string;
};

export type ReportAposentadoria = {
  plan: DividendPlan;
  allocation: Allocation;
  surplus: ReportSurplus;
};

export type ReportViagens = {
  budgetMonthly: string;
  suggestions: TripSuggestion[];
  /** Viagens já marcadas pela família para os próximos 12 meses. */
  confirmedNext12: number;
};

export type ReportMetas = {
  budget: string;
  goals: GoalPlan[];
};

/** Plano de saída das dívidas. Fica em `debt_plan_reports`, por dia (ADR-0019). */
export type ReportDividas = {
  plan: DebtPlan | null;
};

export type { ReportCategorias };

export type ReportData = {
  categorias: ReportCategorias;
  investimentos: ReportInvestimentos;
  aposentadoria: ReportAposentadoria;
  viagens: ReportViagens;
  metas: ReportMetas;
};

export type DailyReportKind = keyof ReportData;

export type DailyReport<K extends DailyReportKind = DailyReportKind> = {
  title: string;
  summary: string;
  message: Message;
  data: ReportData[K];
};
