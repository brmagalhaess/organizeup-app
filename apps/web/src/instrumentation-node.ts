// Registra em ops.deployments o commit que este processo web está rodando.
import { hostname } from "node:os";
import { captureError, recordDeployment, type DiagnosticSource } from "@organizeup/db";

if (process.env.DATABASE_URL) {
  try {
    await recordDeployment({
      service: "web",
      commit: process.env.APP_COMMIT ?? "dev",
      hostname: hostname(),
    });
  } catch (err) {
    console.error(
      JSON.stringify({ level: "error", msg: "record_deployment_failed", err: String(err) }),
    );
  }
}

/** Redirect e 404 passam por erro no Next, mas são fluxo normal. */
const isControlFlow = (error: unknown) => {
  const digest = (error as { digest?: unknown } | null | undefined)?.digest;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_") || digest.startsWith("BAILOUT_TO_CLIENT_SIDE_RENDERING"))
  );
};

export async function reportRequestError(
  error: unknown,
  routePath: string,
  routeType: Extract<DiagnosticSource, "render" | "route" | "action" | "proxy">,
): Promise<void> {
  if (isControlFlow(error)) return;
  await captureError(error, { service: "web", source: routeType, route: routePath });
}
