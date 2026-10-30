# OrganizeUp

Gestão financeira pessoal e aposentadoria para famílias, com um assistente que vive dentro do
sistema e uma equipe de agentes (Paperclip + Codex) que opera e evolui o produto.

> Estado: **Fase 2 em andamento.** Landing, cadastro, família, contas, categorias, receitas e despesas,
> isolamento por RLS testado e deploy pelo Dokploy. Plano completo em
> [docs/plano-mestre.md](docs/plano-mestre.md).

## O que já funciona

Conforme os módulos marcados como disponíveis na página inicial:

- **Família e configurações:** pessoas, cidade e fuso do seu plano.
- **Receitas e despesas:** lançamentos, importação de extrato, salário líquido, 13º, férias e resumo do mês.
- **Calendário:** vencimentos, compromissos e saldo previsto de cada dia.
- **Dívidas e cartões:** faturas, parcelas, juros e ordem para quitar.
- **Reserva e patrimônio:** sua segurança e a evolução do que é seu.
- **Investimentos:** carteira, proventos e classes de ativos.
- **Aposentadoria:** aporte necessário e cenários com premissas claras.
- **Viagens e objetivos:** sonhos com data, custo e aporte mensal.

## Rodando localmente (Windows, macOS ou Linux, sem Docker)

Requisitos: Node 24+, pnpm (via `corepack enable`).

```bash
pnpm install
pnpm db:local          # terminal 1: Postgres local em 127.0.0.1:54329 + migrações
cp .env.example apps/web/.env.local   # ajuste BETTER_AUTH_SECRET
pnpm dev               # terminal 2: http://localhost:3000
pnpm dev:worker        # terminal 3 (opcional): worker com DATABASE_URL de ou_worker
```

Verificação completa: `pnpm check`. E2E: `pnpm --filter @organizeup/web build`, inicie a web
(`pnpm --filter @organizeup/web start`) e rode `pnpm test:e2e`.

## Documentação

- [AGENTS.md](AGENTS.md) — regras do repositório (agentes e humanos)
- [docs/adr](docs/adr) — decisões de arquitetura
- [docs/runbooks](docs/runbooks) — bootstrap (GitHub + Dokploy), deploy, rollback, restore
- [docs/custos.md](docs/custos.md) — custos mensais e tetos
- [docs/ops-api.md](docs/ops-api.md) — API para os agentes (sem dados pessoais)
