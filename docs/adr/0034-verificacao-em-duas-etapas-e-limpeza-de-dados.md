# ADR-0034 — Verificação em duas etapas e limpeza de dados por módulo

Status: aceito (2026-11-09). Pedido do fundador: além de apagar a conta, a pessoa precisa poder limpar
só parte dos dados (investimentos, lançamentos, …), escolhendo o que vai; e isso, como apagar a conta,
exige um segundo fator. O segundo fator é opcional para entrar até a pessoa ativar; depois de ativado,
entrar também passa a exigir. ADR-0011 e ADR-0016 deixavam os dois para a "Fase 7"; esta é ela.

## Decisão

### Segundo fator

- **Plugin `twoFactor` do Better Auth**, só TOTP (aplicativo autenticador) e códigos de reserva. Sem
  código por e-mail: o e-mail é o canal da troca de senha, e o segundo fator não pode cair na mesma
  caixa. Sem "lembrar este aparelho": com o fator ativo, entrar pede o código sempre.
- **Migração 0044**: coluna `user.two_factor_enabled` e tabela `two_factor` (segredo e códigos cifrados
  pelo Better Auth com `BETTER_AUTH_SECRET`, `verified`, bloqueio por tentativas). Só a web lê e grava;
  o worker e o painel do serviço não têm grant. A coluna em `user` é a exceção à regra do ADR-0016
  (coluna nova fora da tabela do Better Auth): o plugin precisa dela na sessão. Vale porque o worker
  migra no boot antes de a web nova subir (a fila do Dokploy é serial).
- **Ativar** (Configurações → Verificação em duas etapas): senha → QR e chave manual → primeiro código
  confirma e ativa → códigos de reserva aparecem uma vez. Desativar pede a senha. Em manutenção, os dois
  ficam fechados como as outras escritas de conta.
- **Entrar**: senha certa numa conta com o fator ativo cai em `/entrar/codigo`, que aceita o código do
  aplicativo ou um código de reserva (consumido). As tentativas são limitadas pelo plugin.
- **Ações que não voltam** (`lib/two-factor.ts`, `verifySecondFactor`): apagar a conta e limpar dados
  conferem o código no servidor, com a sessão aberta, pelo mesmo `verifyTOTP`/`verifyBackupCode`. Sem o
  fator ativo, a ação recusa e a tela manda ativar primeiro. A senha continua sendo pedida para apagar a
  conta (o Better Auth exige).

### Limpeza de dados por módulo

- **Módulos** (`WIPE_SCOPES` em `@organizeup/domain`): receitas e despesas, cartões, renda,
  investimentos, dívidas, metas, viagens, aposentadoria, patrimônio e reserva, agenda, arquivos
  enviados, relatórios e avisos, contas e categorias. A pessoa marca o que quiser; o resto fica.
  Pessoas, membros, ajustes, memórias do assistente e assinatura não entram: para isso há "apagar a
  conta".
- **O que puxa o quê** (`WIPE_REQUIRES`): contas e categorias são apontadas por quase tudo, então
  "contas" leva junto lançamentos, cartões, renda, dívidas, metas e patrimônio, e recria as contas e
  categorias padrão no fim (`ensureFinanceDefaults`). A tela marca e trava o que vai junto; o servidor
  fecha a mesma lista (`expandWipeScopes`), então não há como a tela prometer menos do que o servidor
  faz.
- **Referências que ficam soltam-se** em vez de barrar: parcela de meta ou de dívida paga por um
  lançamento apagado fica sem o vínculo; bem ligado a uma dívida apagada fica sem a dívida; viagem e
  casamento sem o evento da agenda apagado. Filhos saem antes dos pais; o resto é a cascata que já
  existia.
- **Quem**: só o responsável (`owner`) com permissão de escrita, digitando APAGAR e o código do segundo
  fator. Roda numa transação da família, com a RLS; `audit_log` recebe `wipe` com a lista de módulos.
  Visualizador não apaga nada mesmo chamando a função: a RLS devolve zero linhas.
- Teste `packages/db/test/wipe.integration.test.ts` cobre as referências cruzadas e a recriação do
  padrão.

### A receber, na tela de Proventos

Pedido na mesma conversa: a lista "A receber" agrupa por dia de pagamento, com o dia por extenso, quanto
falta e o total daquele dia; dentro, um ativo por linha. Só apresentação.

## Fora por enquanto

- Segundo fator obrigatório para o painel do serviço (ADR-0016 ainda lista como risco aceito). Entra em
  PR próprio, reaproveitando o mesmo plugin.
- Exportar e convidar com segundo fator (ADR-0011): a estrutura está pronta (`verifySecondFactor`).
- Limpar as memórias do assistente já existe em Configurações; não entrou na lista de módulos para não
  duplicar.
