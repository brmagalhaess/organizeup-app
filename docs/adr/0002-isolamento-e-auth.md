# ADR-0002 — Isolamento entre households e fronteira com o Better Auth

Status: aceito (2026-10-29)

## Contexto

Vários usuários e famílias no mesmo banco. Um vazamento entre famílias é o pior incidente possível.
Agentes de IA escrevem parte do código, então a proteção não pode depender só de revisão.

## Decisão

1. **Tenant = household** = `organization` do Better Auth (tabela `household`). Membros em
   `household_member` com papel `owner | adult | child | viewer`.
2. **Tabelas do Better Auth** (`user`, `session`, `account`, `verification`, `household`,
   `household_member`, `household_invitation`) ficam **fora** da RLS de tenant. Só o adapter do Better
   Auth e os helpers `getMembership`/`listMemberships` as usam (ESLint bloqueia `@organizeup/db/auth-db`).
3. **Tabelas de domínio**: `household_id NOT NULL`, `ENABLE` + `FORCE ROW LEVEL SECURITY`.
   - Leitura: `household_id = app_household_id()`.
   - Escrita: `app_can_write()` = papel `owner|adult`, ou `system` **somente** se a conexão for `ou_worker`.
   - `audit_log`: só o owner lê; ninguém altera ou apaga (grant revogado + sem política).
4. **Contexto**: `withHousehold(ctx, fn)` abre uma transação curta e faz
   `set_config('app.household_id' | 'app.user_id' | 'app.role', ..., true)`. O `ctx` só nasce em
   `fromSession()` (valida filiação no banco) ou `fromJob()`; objetos forjados são rejeitados.
   Fora do contexto, a conexão da aplicação não vê nem grava nada (fail-closed).
5. **FKs compostas** `(household_id, id)` entre tabelas de tenant, porque checagens de FK ignoram RLS.
6. **Roles do Postgres** criados pelo migrador:
   - `ou_app` (web) e `ou_worker` (worker): `NOBYPASSRLS`, só DML.
   - `ou_admin`: `BYPASSRLS`, usado apenas por `withAdmin(motivo, fn)`, que loga o motivo.
   - O dono (superusuário do Postgres) só é usado pelo migrador, dentro do container do worker.
7. **IDs** são `text` (UUID gerado pela aplicação). O predicado compara texto com
   `nullif(current_setting(..., true), '')`, então ausência de contexto nunca casa com nada.

## Verificação

`packages/db/test/rls.integration.test.ts` roda no CI contra Postgres real: leitura/escrita cruzada,
FK forjada, viewer sem escrita, auditoria append-only, contexto forjado, `system` fora do worker,
admin enxergando tudo. Todo acesso novo a dados ganha caso neste teste.

## Consequências

- Um bug de código de aplicação que esqueça filtro por household **não vaza**: a RLS devolve só o
  household do contexto.
- A web não tem credencial capaz de ignorar a RLS nem de alterar schema.
