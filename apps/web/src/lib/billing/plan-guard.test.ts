// Trava de revisão: toda tela, action, rota, ferramenta da IA e agente diz a que módulo pertence, e quem
// é de módulo confere `canUse` no servidor. Coisa nova sem classificação reprova aqui.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import * as agents from "@organizeup/agents";
import { AGENT_MODULE } from "@organizeup/agents";
import { ALL_TOOLS, CHAT_ROUTE, toolsFor } from "@organizeup/ai";
import {
  BILLING_MODULES,
  resolveAccess,
  type BillingModule,
  type FamilyAccess,
} from "@organizeup/domain";
import { describe, expect, it } from "vitest";

const src = path.resolve(import.meta.dirname, "../..");
const panel = path.join(src, "app/app/(painel)");

/** Pasta de tela do painel. Null: Base. Pasta nova precisa entrar aqui. */
const SCREENS: Record<string, BillingModule | null> = {
  aposentadoria: "aposentadoria",
  assinatura: null,
  calendario: null,
  cartoes: null,
  categorias: null,
  configuracoes: null,
  contas: null,
  dividas: "dividas",
  familia: null,
  importar: null,
  investimentos: "investimentos",
  lancamentos: null,
  metas: "metas",
  notificacoes: null,
  patrimonio: null,
  plano: "aposentadoria",
  proventos: "investimentos",
  relatorios: null,
  renda: null,
  reserva: null,
  sugestoes: null,
  viagens: "metas",
};

/** Rota de `/api`, pelo caminho. Null: sem dado de módulo. Rota nova precisa entrar aqui. */
const ROUTES: Record<string, BillingModule | null> = {
  // GET confere o módulo; apagar a própria conversa vale sempre, ver OWN_DATA.
  "assistente/conversas/[id]/route.ts": "assistente",
  "assistente/conversas/route.ts": "assistente",
  // A conversa confere em `runChatTurn`, antes de cada chamada, e responde `blocked`.
  "assistente/route.ts": null,
  "ativos/route.ts": "investimentos",
  "auth/[...all]/route.ts": null,
  "diagnostics/route.ts": null,
  "dividas/anexos/[id]/ler/route.ts": "dividas",
  "dividas/anexos/[id]/route.ts": "dividas",
  "dividas/anexos/route.ts": "dividas",
  "health/route.ts": null,
  "mcp/ops/route.ts": null,
  "ops/agents/route.ts": null,
  "ops/context/route.ts": null,
  "ops/deployments/route.ts": null,
  "ops/diagnostics/route.ts": null,
  "ops/memory/route.ts": null,
  "ops/reports/route.ts": null,
  "webhooks/stripe/route.ts": null,
};

/** Ferramenta do assistente. Null: vem com o assistente. Ferramenta nova precisa entrar aqui. */
const TOOLS: Record<string, BillingModule | null> = {
  buscar_conhecimento: null,
  criar_lembrete: null,
  criar_meta_rascunho: "metas",
  listar_categorias: null,
  listar_lancamentos: null,
  listar_metas: "metas",
  listar_viagens: "metas",
  relatorios_do_dia: null,
  resumo_do_mes: null,
  salvar_memoria: null,
  simular_antecipar_aposentadoria: "aposentadoria",
  simular_guardar_mais: "aposentadoria",
  simular_meta: "metas",
  sugerir_aporte: null,
  sugerir_categoria: null,
  sugerir_data_meta: "metas",
  sugestoes_pendentes: null,
  ver_calendario: null,
  ver_carteira: "investimentos",
  ver_dividas: "dividas",
  ver_plano_aposentadoria: "aposentadoria",
  ver_plano_dividas: "dividas",
  ver_plano_do_mes: "aposentadoria",
  ver_proventos: "investimentos",
  ver_relatorio: null,
  ver_renda: null,
  ver_reserva: null,
};

/** O que é direito da pessoa, com ou sem plano (LGPD): usa o papel de verdade, não o módulo. */
const OWN_DATA = new Set(["assistente/conversas/[id]/route.ts DELETE"]);

/**
 * Tabelas de módulo. Fora das pastas deles, só grava quem está aqui, com a razão. Tabela ou arquivo novo
 * que grave dado de módulo reprova até entrar na lista, com a conferência feita.
 */
const MODULE_TABLES =
  "goals|goalContributions|trips|tripCosts|tripPeople|tripIntentions|debts|debtInstallments|debtDocuments|investments|investmentTrades|investmentTargets|investmentStockEvents|dividends|dividendGoals|retirementPlan|retirementScenarios";
const BASE_WRITERS: Record<string, string> = {
  // Baixa de parcela: `confirmCommitment` recusa `d:` e `g:` com o módulo desligado.
  "lib/confirm-entry.ts": "moduleOff",
  // Cadastro complementar: pula o que é de módulo desligado.
  "app/app/(inicio)/completar/actions.ts": 'canUse(await readFamilyAccess(ctx), "aposentadoria")',
};

function walk(folder: string, keep: (name: string) => boolean): string[] {
  return readdirSync(folder).flatMap((name) => {
    const file = path.join(folder, name);
    if (statSync(file).isDirectory()) return walk(file, keep);
    return keep(name) ? [file] : [];
  });
}

/** Cada `export async function`, até o `}` na primeira coluna que a fecha. */
const exportedBodies = (source: string) =>
  [...source.matchAll(/^export async function (\w+)[\s\S]*?^}/gm)].map((match) => ({
    name: match[1]!,
    body: match[0],
  }));

/** Todo arquivo que o navegador alcança: actions e rotas, com qualquer nome. */
const serverFiles = (folder: string) =>
  walk(folder, (name) => /\.tsx?$/.test(name) && !name.includes(".test.")).filter((file) => {
    const source = readFileSync(file, "utf8");
    return path.basename(file) === "route.ts" || source.trimStart().startsWith('"use server"');
  });

const folders = readdirSync(panel).filter((name) => statSync(path.join(panel, name)).isDirectory());

describe("telas e actions", () => {
  it("toda pasta do painel está classificada", () => {
    expect(folders.filter((name) => !(name in SCREENS))).toEqual([]);
  });

  const modular = folders.filter((name) => SCREENS[name]);

  it.each(modular)("%s: toda tela mostra o convite com o módulo desligado", (folder) => {
    const pages = walk(path.join(panel, folder), (name) => name === "page.tsx");
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      expect(readFileSync(page, "utf8"), page).toContain(`moduleInvite("${SCREENS[folder]}")`);
    }
  });

  it.each(modular)(
    "%s: todo arquivo de servidor confere o módulo, em qualquer subpasta",
    (folder) => {
      const files = serverFiles(path.join(panel, folder));
      for (const file of files) {
        const source = readFileSync(file, "utf8");
        expect(source, file).not.toContain("requireTenant");
        const bodies = exportedBodies(source);
        expect(bodies.length, file).toBeGreaterThan(0);
        for (const { name, body } of bodies) {
          expect(body, `${file} ${name}`).toContain(`requireModule("${SCREENS[folder]}")`);
        }
      }
    },
  );

  it("a importação de Investimentos entra na regra", () => {
    const files = serverFiles(path.join(panel, "investimentos")).map((file) =>
      path.relative(panel, file).replaceAll("\\", "/"),
    );
    expect(files).toContain("investimentos/importar/actions.ts");
  });
});

describe("Base que grava dado de módulo", () => {
  // Sem o fecha-parêntese de propósito: `.insert(goals as never)` também conta.
  const WRITE = new RegExp(`\\.(insert|update|delete)\\(\\s*(${MODULE_TABLES})\\b`);
  const modular = folders.filter((name) => SCREENS[name]).map((name) => path.join(panel, name));

  it("só quem está na lista, e cada um confere o plano", () => {
    const files = [
      ...walk(path.join(src, "app"), (name) => /\.tsx?$/.test(name)),
      ...walk(path.join(src, "lib"), (name) => /\.tsx?$/.test(name)),
    ].filter(
      (file) =>
        !file.includes(".test.") &&
        !file.includes(`${path.sep}admin${path.sep}`) &&
        !modular.some((folder) => file.startsWith(folder)),
    );
    const writers = files
      .filter((file) => WRITE.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(src, file).replaceAll("\\", "/"));
    expect(writers.toSorted()).toEqual(Object.keys(BASE_WRITERS).toSorted());
    for (const [file, guard] of Object.entries(BASE_WRITERS)) {
      expect(readFileSync(path.join(src, file), "utf8"), file).toContain(guard);
    }
  });
});

describe("rotas de /api", () => {
  const api = path.join(src, "app/api");
  const routes = walk(api, (name) => name === "route.ts").map((file) =>
    path.relative(api, file).replaceAll("\\", "/"),
  );

  it("toda rota está classificada", () => {
    expect(routes.filter((route) => !(route in ROUTES))).toEqual([]);
  });

  it.each(routes.filter((route) => ROUTES[route]))("%s confere o módulo", (route) => {
    const source = readFileSync(path.join(api, route), "utf8");
    for (const { name, body } of exportedBodies(source)) {
      const gate = OWN_DATA.has(`${route} ${name}`)
        ? "requireOwnData()"
        : `requireModule("${ROUTES[route]}")`;
      expect(body, name).toContain(gate);
    }
  });

  it("rota de módulo que devolve dado responde 403 com o módulo desligado", () => {
    for (const route of [
      "ativos/route.ts",
      "dividas/anexos/[id]/route.ts",
      "assistente/conversas/route.ts",
      "assistente/conversas/[id]/route.ts",
    ]) {
      expect(readFileSync(path.join(api, route), "utf8"), route).toContain("allowed");
    }
  });

  it("a conversa não fala com o modelo sem passar pelo portão", () => {
    expect(readFileSync(path.join(api, "assistente/route.ts"), "utf8")).toContain("runChatTurn");
  });
});

const NOW = new Date("2026-11-01T12:00:00Z");
const onlyBase = (extra: string[] = []): FamilyAccess =>
  resolveAccess({
    billingEnabled: true,
    subscription: {
      courtesy: false,
      courtesyUntil: null,
      trialEndsAt: null,
      status: "active",
      items: ["base:50", ...extra].map((item) => ({
        price: `price_${item}`,
        item,
        amount: "9.90",
        quantity: 1,
      })),
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
    },
    now: NOW,
  });

describe("ferramentas do assistente", () => {
  it("toda ferramenta está classificada, igual ao que ela declara", () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.name in TOOLS, tool.name).toBe(true);
      expect(tool.module, tool.name).toBe(TOOLS[tool.name]);
    }
  });

  it.each(BILLING_MODULES.filter((module) => module !== "assistente"))(
    "sem %s, nenhuma ferramenta dele vai ao modelo",
    (module) => {
      const names = toolsFor(CHAT_ROUTE, onlyBase(["assistente:30"])).map((tool) => tool.name);
      for (const tool of ALL_TOOLS.filter((item) => item.module === module)) {
        expect(names, tool.name).not.toContain(tool.name);
      }
      const on = toolsFor(CHAT_ROUTE, onlyBase(["assistente:30", `modulo:${module}`]));
      for (const tool of ALL_TOOLS.filter((item) => item.module === module)) {
        expect(
          on.map((item) => item.name),
          tool.name,
        ).toContain(tool.name);
      }
    },
  );

  it("sem plano nenhum, sobra só o que vem com o assistente", () => {
    const names = toolsFor(CHAT_ROUTE, onlyBase()).map((tool) => tool.name);
    expect(names).toContain("resumo_do_mes");
    expect(names).not.toContain("ver_carteira");
  });
});

describe("agentes", () => {
  const worker = readFileSync(path.resolve(src, "../../worker/src/daily-agents.ts"), "utf8");
  const constants = Object.fromEntries(
    Object.entries(agents).filter(([name]) => name.endsWith("_AGENT")),
  ) as Record<string, string>;
  const listed = [
    ...(/DAILY_AGENTS = \[([\s\S]*?)\]/.exec(worker)?.[1] ?? "").matchAll(/\w+_AGENT/g),
  ].map((match) => constants[match[0]]);

  it("a lista da rodada é exatamente a classificação", () => {
    expect(listed.length).toBeGreaterThanOrEqual(8);
    expect(listed.toSorted()).toEqual(Object.keys(AGENT_MODULE).toSorted());
  });

  it("todo agente chamado na rodada passa pelo portão", () => {
    const called = [...worker.matchAll(/await run\((\w+_AGENT)/g)].map(
      (match) => constants[match[1]!],
    );
    for (const agent of called) expect(listed, agent).toContain(agent);
    // Os dois que não passam por `run`, porque a chamada ao modelo fica fora de transação.
    expect(worker).toContain("agentMayRun(CATEGORIAS_IA_AGENT, access)");
    expect(listed.filter((agent) => !called.includes(agent))).toEqual(["categorias_ia"]);
  });

  it("dicas, mercado e parágrafo dos relatórios conferem o plano no próprio portão", () => {
    const read = (file: string) => readFileSync(path.resolve(src, "../../..", file), "utf8");
    expect(read("packages/ai/src/insights/nightly.ts")).toContain(
      '"assistente")) return "sem_plano"',
    );
    expect(read("packages/ai/src/relatorios.ts")).toContain("nightGate");
    expect(read("packages/agents/src/run-mercado.ts")).toContain('canUse(access, "investimentos")');
  });
});
