// Executado uma vez quando o servidor Next inicia (não roda no build).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
