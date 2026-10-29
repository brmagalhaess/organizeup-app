// Registra em ops.deployments o commit que este processo web está rodando.
import { hostname } from "node:os";
import { recordDeployment } from "@organizeup/db";

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
