# Ops API (para os agentes)

Base: `https://<domínio>/api/ops`. Autenticação: `Authorization: Bearer <token>`.
O servidor guarda só o SHA-256 dos tokens (`OPS_TOKEN_HASHES`). Um token por agente; revogar =
remover o hash e reimplantar a web. **Nenhuma rota devolve dados pessoais.**

Gerar token + hash:

```bash
node -e "const c=require('crypto');const t=c.randomBytes(32).toString('base64url');console.log('token',t);console.log('hash',c.createHash('sha256').update(t).digest('hex'))"
```

## Rotas (Fase 0)

| Rota                                | Retorno                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET /api/health` (pública)         | `status`, `commit`, `uptimeSeconds`, `db.schemaVersion`. `?probe=live` só o processo       |
| `GET /api/ops/deployments?limit=20` | `current.web`, `deployments[]` (serviço, commit, host, início), `workers[]` (último sinal) |

## Próximas (Fase 1)

`GET /api/ops/context?agent=<slug>`, `POST /api/ops/memory`, `GET /api/ops/reports`,
`GET /api/ops/diagnostics` — ver `docs/plano-mestre.md`, seção 6.
