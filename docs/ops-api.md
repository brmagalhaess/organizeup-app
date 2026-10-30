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

## Memória e relatórios

Tudo no schema `ops`, sem dados pessoais. Escrita com aparência de e-mail, CPF, CNPJ, telefone ou cartão
recebe 422; `@example.com` é permitido. É uma barreira de melhor esforço, não substitui a regra.

| Rota                                      | O que faz                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| `GET /api/ops/context?agent=<slug>&q=...` | Ao acordar: produção, relatórios recentes, memórias próprias e da equipe |
| `GET /api/ops/memory?agent=&q=`           | Busca em português; sem `q`, as mais recentes                            |
| `POST /api/ops/memory`                    | `{agent, kind, content, sourceIssue?, supersedes?}`                      |
| `GET /api/ops/reports?kind=&limit=`       | Relatórios mais recentes                                                 |
| `POST /api/ops/reports`                   | `{kind, period, agent, title, body}`; mesmo tipo e período atualiza      |

`kind` de memória: `fato`, `decisao`, `licao`, `preferencia`. De relatório: `saude`, `semanal`, `incidente`,
`custos`, `produto`. A aplicação não apaga memória nem relatório.

## Próxima

`GET /api/ops/diagnostics`, quando houver coleta de erros — ver `docs/plano-mestre.md`, seção 6.
