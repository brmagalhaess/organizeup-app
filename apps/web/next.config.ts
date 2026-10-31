import path from "node:path";
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// CSP: sem domínios externos. Ao adicionar R2/Sentry (Fases 1–3), liste-os aqui explicitamente.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  // Monorepo: o tracing precisa enxergar a raiz para copiar os pacotes do workspace.
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  transpilePackages: ["@organizeup/agents", "@organizeup/db", "@organizeup/domain"],
  poweredByHeader: false,
  experimental: {
    // Importação de extrato: até 2.000 linhas por envio (ADR-0006).
    serverActions: { bodySizeLimit: "3mb" },
  },
  async redirects() {
    return [
      { source: "/app/mes", destination: "/app/lancamentos", permanent: true },
      // Endereço antigo: telas vão para o novo; /api continua respondendo para os agentes.
      {
        source: "/:path((?!api/).*)",
        has: [{ type: "host", value: "organizeup.home.crowntech.com.br" }],
        destination: "https://organizeup.crowntech.com.br/:path",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          ...(isDev
            ? []
            : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
        ],
      },
    ];
  },
};

export default nextConfig;
