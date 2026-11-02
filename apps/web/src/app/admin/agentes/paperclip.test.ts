import { describe, expect, it } from "vitest";
import {
  agentName,
  agentsInView,
  DICAS_AGENT,
  MERCADO_AGENT,
  onlyAgents,
  PRODUCT_AGENTS,
  runMetrics,
} from "./catalogo";
import { lastActivity, PAPERCLIP_TEAM, paperclipAgentUrl } from "./paperclip";

const tech = PAPERCLIP_TEAM.find((agent) => agent.id === "tech-lead")!;
const qa = PAPERCLIP_TEAM.find((agent) => agent.id === "revisor-qa")!;
const old = new Date("2026-10-01T10:00:00Z");
const recent = new Date("2026-10-30T10:00:00Z");

describe("equipe do Paperclip", () => {
  it("traz os 16 agentes, sem repetir, com Dívidas e Relatórios", () => {
    expect(PAPERCLIP_TEAM).toHaveLength(16);
    expect(new Set(PAPERCLIP_TEAM.map((agent) => agent.id)).size).toBe(16);
    for (const name of ["Dívidas", "Relatórios"]) {
      expect(PAPERCLIP_TEAM.map((agent) => agent.name)).toContain(name);
    }
  });

  it("os agentes do produto dizem a hora em que o Paperclip acorda", () => {
    const wake = (id: string) => PRODUCT_AGENTS.find((agent) => agent.id === id)?.wake;
    expect(wake("dividas")).toContain("04:15");
    expect(wake("relatorios")).toContain("05:40");
  });

  it("sem registro, a atividade é nula: nada de status inventado", () => {
    expect(lastActivity(tech, [])).toBeNull();
    expect(lastActivity(tech, [{ agent: "sre", at: recent, source: "relatorio" }])).toBeNull();
  });

  it("fica com o registro mais novo, venha de onde vier", () => {
    const found = lastActivity(tech, [
      { agent: "tech-lead", at: old, source: "relatorio" },
      { agent: "tech-lead", at: recent, source: "memoria" },
    ]);
    expect(found).toMatchObject({ at: recent, source: "memoria" });
  });

  it("aceita o nome curto com que o agente assina", () => {
    const records = [{ agent: "revisor", at: recent, source: "memoria" as const }];
    expect(lastActivity(qa, records)?.at).toEqual(recent);
  });

  it("sem id, o link vai para a tela geral de agentes", () => {
    expect(paperclipAgentUrl(tech)).toBe("https://paperclip.home.crowntech.com.br/ORG/agents");
    expect(paperclipAgentUrl({ ...tech, paperclipId: "abc" })).toMatch(/\/agents\/abc$/);
  });
});

describe("agentes do produto", () => {
  it("Mercado e Dicas entram como cartões, com controles", () => {
    const ids = agentsInView([]).map((agent) => agent.id);
    expect(ids).toEqual(expect.arrayContaining(["metas", MERCADO_AGENT, DICAS_AGENT]));
    expect(agentsInView([]).every((agent) => agent.controls)).toBe(true);
  });

  it("agente que só existe nas rodadas aparece sem controles", () => {
    const view = agentsInView(["metas", "novo", "novo"]);
    expect(view.filter((agent) => agent.id === "metas")).toHaveLength(1);
    expect(view.filter((agent) => agent.id === "novo")).toEqual([
      expect.objectContaining({ name: "Novo", controls: false }),
    ]);
  });

  it("linha só de contagem não vira agente, nem no cartão nem no histórico", () => {
    const ids = agentsInView(["metas", "viagens-intencoes"]).map((agent) => agent.id);
    expect(ids).not.toContain("viagens-intencoes");
    const runs = [{ agent: "viagens-intencoes" }, { agent: "metas" }];
    expect(onlyAgents(runs)).toEqual([{ agent: "metas" }]);
  });

  it("todo nome cabe no CHECK de ops.agent_runs", () => {
    for (const { id } of PRODUCT_AGENTS) expect(id).toMatch(/^[a-z0-9-]{1,40}$/);
  });

  it("mostra o nome conhecido, ou o id com inicial maiúscula", () => {
    expect(agentName(DICAS_AGENT)).toBe("Dicas");
    expect(agentName("outro")).toBe("Outro");
  });

  it("cada agente lê os números da rodada com o nome certo", () => {
    const run = { households: 3, ok: 2, failed: 1, suggestions: 4, applied: 5 };
    const labels = (agent: string) => runMetrics(agent, run, 7).map((item) => item.label);
    expect(labels("metas")).toEqual(["Famílias", "Falhas", "Sugestões", "Aplicadas"]);
    expect(labels(MERCADO_AGENT)).toContain("Cotações");
    expect(runMetrics(DICAS_AGENT, run, 7)).toContainEqual({ label: "Descartadas", value: 7 });
  });
});
