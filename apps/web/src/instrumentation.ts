import type { Instrumentation } from "next";

// Executado uma vez quando o servidor Next inicia (não roda no build).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}

// Erro do servidor (tela, rota, action) vira diagnóstico para a equipe. `request` traz a query string
// e os cabeçalhos: fica de fora, e só a rota do arquivo é lida.
export const onRequestError: Instrumentation.onRequestError = async (error, _request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportRequestError } = await import("./instrumentation-node");
  // Sem await: a resposta ao usuário não espera o registro.
  void reportRequestError(error, context.routePath, context.routeType);
};
