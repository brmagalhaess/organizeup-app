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

| Rota                                      | O que faz                                                                                     |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| `GET /api/ops/context?agent=<slug>&q=...` | Ao acordar: produção, relatórios recentes, memórias, contagens da categorização e `agentRuns` |
| `GET /api/ops/memory?agent=&q=`           | Busca em português; sem `q`, as mais recentes                                                 |
| `POST /api/ops/memory`                    | `{agent, kind, content, sourceIssue?, supersedes?}`                                           |
| `GET /api/ops/reports?kind=&limit=`       | Relatórios mais recentes                                                                      |
| `POST /api/ops/reports`                   | `{kind, period, agent, title, body}`; mesmo tipo e período atualiza                           |

`kind` de memória: `fato`, `decisao`, `licao`, `preferencia`. De relatório: `saude`, `semanal`, `incidente`,
`custos`, `produto`. A aplicação não apaga memória nem relatório.

## Agentes diários do produto (`agentRuns`)

`GET /api/ops/context` devolve `agentRuns`: os últimos 14 dias de `ops.agent_runs`, uma linha por dia e
agente (`categorias`, `investimentos`, `aposentadoria`, `viagens`, `metas`). O worker grava ao terminar cada
agente; rodar de novo no mesmo dia substitui as contagens e soma 1 em `runs`. Só números, nunca uma família.

| Campo         | Significado                                                        |
| ------------- | ------------------------------------------------------------------ |
| `day`         | Dia da execução (`YYYY-MM-DD`, fuso America/Sao_Paulo)             |
| `agent`       | Nome do agente                                                     |
| `runs`        | Quantas vezes rodou nesse dia                                      |
| `households`  | Famílias ativas percorridas (sessão nos últimos 60 dias)           |
| `ok`          | Famílias em que o agente terminou sem erro                         |
| `failed`      | Famílias em que o agente falhou (a família seguinte não é afetada) |
| `suggestions` | Sugestões pendentes criadas ou atualizadas                         |
| `applied`     | Alterações automáticas aplicadas (dado derivado, com Desfazer)     |
| `durationMs`  | Duração da última execução, em milissegundos                       |

Quem lê: Tech Lead na rotina das 06:00 (abre reparo se `failed > 0`) e SRE às 07:30. `failed > 0` ou dia sem
linha depois das 06:00 é tarefa. O painel `/admin` mostra os mesmos 7 últimos dias para o responsável.

## Próxima

`GET /api/ops/diagnostics`, quando houver coleta de erros — ver `docs/plano-mestre.md`, seção 6.
