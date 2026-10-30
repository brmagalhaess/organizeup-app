# ADR-0010 — Equipe de agentes no Paperclip

Status: aceito (2026-10-30)

## Decisão

- **Empresa OrganizeUP no Paperclip** (`paperclip.home.crowntech.com.br`), com Tech Lead, Engenheiro, Revisor
  QA, SRE e Gestor de Agentes. Todos usam `codex_local`, engine `cli`, com o login do Codex que já existe no
  servidor. Sem heartbeat por intervalo: acordam por tarefa ou rotina, uma execução por vez.
- **Instruções no repositório** (`paperclip/agentes/`). No Paperclip fica só um arquivo curto que manda baixar o
  código e ler esses arquivos, com os limites essenciais repetidos. Assim toda mudança de comportamento
  passa por PR e pode ser revertida.
- **Cada agente tem sua pasta** (`/paperclip/workspaces/organizeup/<slug>`) e seu clone. Um projeto com só
  `repoUrl` falha na validação do Paperclip, porque não há checkout no servidor.
- **Chave do GitHub** fine-grained, só em `organizeup-v3`, com Contents e Pull requests. Sem Workflows nem
  Administration: agente não altera automações nem regras do repositório. Vence em 28/01/2027.
- **Agentes não têm** credencial do Dokploy, do Cloudflare ou do banco. Só `GH_TOKEN` e `OPS_TOKEN`, como
  segredos cifrados do Paperclip, entregues pelo ambiente do projeto.
- **Criar agente**: só o Gestor, e toda contratação depende de aprovação do fundador
  (`requireBoardApprovalForNewAgents`). O padrão do Paperclip dava a permissão a todos; foi retirada.
- **Memória e relatórios no banco** (`ops.agent_memory`, `ops.reports`), pela Ops API. Sem dados pessoais: a
  rota recusa texto com aparência de e-mail, CPF, CNPJ, telefone ou cartão, e a aplicação não apaga nada.

## Riscos aceitos

- **Sem proteção no GitHub.** Sem GitHub Pro não há regra de branch em repositório privado, e sem GitHub Actions
  não há CI. A chave consegue enviar direto para `main`, que publica sozinho. O portão é a instrução aos
  agentes e o `pnpm check` rodado pelo Revisor. Ativar o GitHub Pro resolve isso de verdade.
- **Mesmo Paperclip para várias empresas.** Agentes rodam no mesmo processo e usuário. Um agente comprometido
  poderia alcançar segredos de outras empresas do servidor. Por isso nada ali dá acesso à produção.
- **Assinatura compartilhada.** O Codex usa a mesma assinatura das outras empresas, sem orçamento separado.
