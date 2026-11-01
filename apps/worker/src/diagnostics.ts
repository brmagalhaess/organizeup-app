// Erros do worker para `ops.diagnostics`. O registro nunca falha e, por dentro, tem tempo máximo:
// o job segue como seguiria sem ele.
import { captureError } from "@organizeup/db";

export const reportJobFailure = (name: string, error: unknown) =>
  captureError(error, { service: "worker", source: "job", route: `job:${name}` });

/** Falha de uma família num agente diário. A família não entra no registro. */
export const reportAgentFailure = (agent: string, error: unknown) =>
  captureError(error, { service: "worker", source: "agent", route: `agente:${agent}` });

/** Handler do pg-boss que registra a falha e a devolve, para a fila tratar como sempre. */
export function reportingFailures<Jobs>(name: string, handler: (jobs: Jobs) => Promise<void>) {
  return async (jobs: Jobs): Promise<void> => {
    try {
      await handler(jobs);
    } catch (error) {
      await reportJobFailure(name, error);
      throw error;
    }
  };
}
