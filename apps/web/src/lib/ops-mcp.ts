// Servidor MCP da equipe do Paperclip: as mesmas leituras e escritas da Ops API, sem dado de família.
import {
  addAgentMemory,
  captureError,
  findAgentMemories,
  listReports,
  resolveDiagnostic,
  saveReport,
} from "@organizeup/db";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { findPersonalData, memorySchema, reportSchema } from "./ops-content";
import {
  diagnosticFiltersSchema,
  loadDiagnostics,
  loadOpsContext,
  loadOpsDeployments,
  resolveDiagnosticSchema,
} from "./ops-data";

const failure = (text: string) => ({ isError: true, content: [{ type: "text" as const, text }] });

/** A resposta passa pela mesma barreira da escrita antes de sair. */
function reply(data: unknown) {
  const text = JSON.stringify(data);
  const found = findPersonalData(text);
  if (found) return failure(`A resposta parece conter ${found} e não foi devolvida.`);
  return { content: [{ type: "text" as const, text }] };
}

/** Falha vira mensagem fixa: a do banco pode repetir os valores da consulta. */
function tool<Input>(name: string, run: (input: Input) => Promise<unknown>) {
  return async (input: Input) => {
    try {
      return reply(await run(input));
    } catch (error) {
      await captureError(error, { service: "web", source: "route", route: "/api/mcp/ops" });
      return failure(`Não foi possível concluir ${name} agora. Tente de novo.`);
    }
  };
}

const READ_ONLY = { readOnlyHint: true, openWorldHint: false };

const agentFilter = {
  agent: z.string().max(40).optional().describe("Slug do agente, como sre ou tech-lead."),
};

export function createOpsMcpServer(): McpServer {
  const server = new McpServer(
    { name: "organizeup-ops", version: "1.0.0" },
    {
      instructions:
        "Operação do OrganizeUp para a equipe de agentes. Nada aqui traz dado de família, e a " +
        "escrita recusa e-mail, CPF, CNPJ, telefone e cartão. Comece por contexto_producao.",
    },
  );

  server.registerTool(
    "contexto_producao",
    {
      description:
        "O que ler ao acordar: commit, banco, deploys, workers, relatórios, memórias, contagens " +
        "dos agentes diários, erros abertos e taxa de erro por versão.",
      inputSchema: {
        ...agentFilter,
        q: z.string().max(200).optional().describe("Assunto da tarefa, para buscar memórias."),
      },
      annotations: READ_ONLY,
    },
    tool("contexto_producao", ({ agent, q }) => loadOpsContext({ agent, query: q })),
  );

  server.registerTool(
    "listar_deploys",
    {
      description: "Últimos boots de web e worker, com o commit que cada um está rodando.",
      inputSchema: { limit: z.number().int().min(1).max(100).optional() },
      annotations: READ_ONLY,
    },
    tool("listar_deploys", ({ limit }) => loadOpsDeployments(limit ?? 20)),
  );

  server.registerTool(
    "listar_erros_abertos",
    {
      description:
        "Erros por impressão digital: tipo, rota, serviço, código, contagem, versões e arquivo e " +
        "linha do nosso código. Por padrão, só os abertos. Traz também a taxa por versão.",
      inputSchema: diagnosticFiltersSchema.shape,
      annotations: READ_ONLY,
    },
    tool("listar_erros_abertos", loadDiagnostics),
  );

  server.registerTool(
    "marcar_erro_resolvido",
    {
      description:
        "Marca um erro como resolvido em todas as versões. Use depois que o reparo estiver em " +
        "produção: se o erro voltar, ele reabre sozinho.",
      inputSchema: resolveDiagnosticSchema.shape,
      annotations: { idempotentHint: true, openWorldHint: false },
    },
    tool("marcar_erro_resolvido", async ({ fingerprint }) => ({
      resolved: await resolveDiagnostic(fingerprint),
    })),
  );

  server.registerTool(
    "listar_relatorios",
    {
      description: "Relatórios mais recentes da equipe, opcionalmente de um tipo.",
      inputSchema: {
        kind: reportSchema.shape.kind.optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: READ_ONLY,
    },
    tool("listar_relatorios", async ({ kind, limit }) => ({
      reports: await listReports({ kind, limit }),
    })),
  );

  server.registerTool(
    "salvar_relatorio",
    {
      description: "Cria um relatório, ou atualiza o do mesmo tipo e período. Sem dado pessoal.",
      inputSchema: reportSchema.shape,
      annotations: { idempotentHint: true, openWorldHint: false },
    },
    tool("salvar_relatorio", async (report) => ({ report: await saveReport(report) })),
  );

  server.registerTool(
    "buscar_memoria",
    {
      description: "Memórias vigentes da equipe, pela busca em português ou as mais recentes.",
      inputSchema: { ...agentFilter, q: z.string().max(200).optional() },
      annotations: READ_ONLY,
    },
    tool("buscar_memoria", async ({ agent, q }) => ({
      memories: await findAgentMemories({ agent, query: q }),
    })),
  );

  server.registerTool(
    "salvar_memoria",
    {
      description:
        "Guarda o que evita repetir erro ou trabalho, em uma ou duas frases. Sem dado pessoal.",
      inputSchema: memorySchema.shape,
      annotations: { openWorldHint: false },
    },
    tool("salvar_memoria", async (memory) => ({ memory: await addAgentMemory(memory) })),
  );

  return server;
}
