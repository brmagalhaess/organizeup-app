// Servidor falso do modelo, só para o e2e: fala o formato de streaming da API em /v1/messages. A
// web só aponta para cá com AI_TEST_BASE_URL fora de produção e nesta máquina (ver
// packages/ai/src/client.ts). Na primeira volta pede uma ferramenta; depois responde em duas partes.
// Pergunta que começa com "Anote:" pede salvar_memoria com o resto do texto.
//   node apps/web/e2e/fake-model.mjs [porta]
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 3199);

const sse = (response, events) => {
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const event of events) {
    response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }
  response.end();
};

const envelope = (stop_reason, blocks, output_tokens) => [
  {
    type: "message_start",
    message: {
      id: "msg_e2e",
      type: "message",
      role: "assistant",
      model: "claude-haiku-5-5",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 120,
        output_tokens: 1,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 800,
      },
    },
  },
  ...blocks,
  {
    type: "message_delta",
    delta: { stop_reason, stop_sequence: null },
    usage: { output_tokens },
  },
  { type: "message_stop" },
];

const toolTurn = (name, input) =>
  envelope(
    "tool_use",
    [
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "toolu_e2e", name, input: {} },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(input) },
      },
      { type: "content_block_stop", index: 0 },
    ],
    12,
  );

const textTurn = (parts) =>
  envelope(
    "end_turn",
    [
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      ...parts.map((text) => ({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text },
      })),
      { type: "content_block_stop", index: 0 },
    ],
    30,
  );

const readBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const hasToolResult = (messages) =>
  messages.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some((block) => block.type === "tool_result"),
  );

const NOTE = /^Anote: (.+)$/;

const noteIn = (messages) => {
  const question = messages.findLast(
    (message) => message.role === "user" && typeof message.content === "string",
  );
  return question?.content.match(NOTE)?.[1];
};

createServer(async (request, response) => {
  if (request.method !== "POST" || !request.url?.startsWith("/v1/messages")) {
    response.writeHead(404).end();
    return;
  }
  const { messages } = await readBody(request);
  if (hasToolResult(messages)) {
    sse(response, textTurn(["Olhei seu mês. **Tudo em ordem** ", "por aqui, sem surpresas."]));
  } else {
    const note = noteIn(messages);
    sse(
      response,
      note
        ? toolTurn("salvar_memoria", { tipo: "preferencia", texto: note })
        : toolTurn("resumo_do_mes", {}),
    );
  }
}).listen(port, "127.0.0.1", () => console.log(`modelo falso em 127.0.0.1:${port}`));
