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

## Erros (`ops.diagnostics`)

Web e worker gravam cada erro em `ops.diagnostics`, sem atrapalhar a requisição nem o job. **Nunca entram**
mensagem de erro, corpo, query string, e-mail ou id de família: mensagem de erro pode trazer valor de família.
Os `CHECK` da tabela recusam texto livre.

| Rota                                                                             | O que faz                                               |
| -------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `GET /api/ops/diagnostics?status=&service=&source=&commit=&route=&since=&limit=` | `diagnostics[]` e `errorRates[]`                        |
| `POST /api/ops/diagnostics`                                                      | `{fingerprint}` marca resolvido em todas as versões     |
| `GET /api/ops/context`                                                           | Também traz `diagnostics` (20 abertos) e `errorRates`   |
| `POST /api/diagnostics` (pública)                                                | Uso das telas de erro: `{fingerprint, route}`, sem mais |

`status`: `aberto` (padrão), `resolvido` ou `todos`. `service`: `web`, `worker`. `source`: `render`, `route`,
`action`, `proxy`, `client`, `job`, `agent`. `since`: data ou data e hora ISO, sobre a última ocorrência.
`limit`: até 100.

| Campo de `diagnostics[]` | Significado                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `fingerprint`            | Identifica o erro: serviço, origem, tipo, código, rota e arquivo. Não muda com a mensagem nem com a versão |
| `errorType`              | Nome do tipo do erro. `ErroDeTela` é o que só o navegador viu                                              |
| `route`                  | Rota sem parâmetros (`/app/metas/[id]`) ou nome fixo (`job:market-data`, `agente:metas`, `acao:...`)       |
| `code`                   | Código do erro, como o do Postgres, quando houver                                                          |
| `stack`                  | Até 8 linhas de arquivo e linha do nosso código, da versão mais recente                                    |
| `count`                  | Ocorrências, somando as versões filtradas                                                                  |
| `commits`                | Versões em que apareceu, da mais recente à mais antiga                                                     |
| `firstSeenAt`            | Primeira ocorrência entre as linhas filtradas                                                              |
| `lastSeenAt`             | Última ocorrência entre as linhas filtradas                                                                |
| `status`                 | `aberto` ou `resolvido`. Resolvido que volta a acontecer reabre sozinho                                    |

Na web em produção, a `stack` aponta para o arquivo gerado (`.next/server/chunks/...:1:1456`), não para o
fonte: o Next não aplica mapa de fonte em `error.stack`. Para achar o código, use `route`, `errorType` e `code`.
No worker, a pilha já vem do fonte (`src/daily-agents.ts:60`).

`errorRates[]` traz as 5 versões mais novas: `commit`, `startedAt`, `occurrences`, `fingerprints` e `perHour`
(ocorrências por hora no tempo em que aquela versão ficou no ar, contando no mínimo 15 minutos). O SRE compara
essa taxa depois do merge (`paperclip/agentes/sre.md`). Conta ocorrências, não visitas.

Limites: 1.000 ocorrências por dia em cada impressão digital e versão, depois disso a contagem para até o dia
seguinte; 100 erros novos por dia em cada `source`; `POST /api/diagnostics` aceita 20 por minuto por IP e 300
por minuto no total. O IP fica só na memória do processo. Quem bate no teto não recebe erro nenhum.

## MCP da equipe (`/api/mcp/ops`)

Servidor MCP em Streamable HTTP, sem estado: só `POST`, resposta em JSON, mesmo token da Ops API
(`Authorization: Bearer <token>`). Tudo sem dado de família: a escrita usa os mesmos esquemas da API e a
resposta passa pela mesma barreira `findPersonalData` antes de sair.

| Ferramenta              | Equivale a                  |
| ----------------------- | --------------------------- |
| `contexto_producao`     | `GET /api/ops/context`      |
| `listar_deploys`        | `GET /api/ops/deployments`  |
| `listar_erros_abertos`  | `GET /api/ops/diagnostics`  |
| `marcar_erro_resolvido` | `POST /api/ops/diagnostics` |
| `listar_relatorios`     | `GET /api/ops/reports`      |
| `salvar_relatorio`      | `POST /api/ops/reports`     |
| `buscar_memoria`        | `GET /api/ops/memory`       |
| `salvar_memoria`        | `POST /api/ops/memory`      |

Codex (`~/.codex/config.toml`), com o token em `OPS_TOKEN`:

```toml
[mcp_servers.organizeup-ops]
url = "https://organizeup.crowntech.com.br/api/mcp/ops"
bearer_token_env_var = "OPS_TOKEN"
```

Claude Code:

```bash
claude mcp add --transport http organizeup-ops https://organizeup.crowntech.com.br/api/mcp/ops \
  --header "Authorization: Bearer $OPS_TOKEN"
```

Conferir sem cliente MCP (o cabeçalho `Accept` é exigido pelo protocolo):

```bash
curl -s -X POST -H "Authorization: Bearer $OPS_TOKEN" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  https://organizeup.crowntech.com.br/api/mcp/ops
```
