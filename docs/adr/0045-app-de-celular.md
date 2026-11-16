# ADR-0045 — App de celular (iOS e Android)

Status: aceito (2026-11-16). Pedido do fundador: um app de verdade nas lojas, com telas nativas, e não o site
dentro de uma moldura.

## Contexto

O site é feito primeiro para celular, mas não é PWA e não tinha API de dados: as telas leem o banco em Server
Components e gravam por Server Actions. Um app nativo precisa de uma API, e de um jeito de entrar que não
dependa do cookie do navegador.

Três caminhos foram comparados:

| Caminho                         | A favor                                     | Contra                                                                  |
| ------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------- |
| Site numa moldura (Capacitor)   | Dias de trabalho, uma base só               | Regra 4.2 da Apple (funcionalidade mínima); não é o que o fundador quer |
| PWA empacotado                  | Dias de trabalho                            | Não existe PWA hoje; no iOS cai na mesma regra 4.2                      |
| **React Native (Expo), nativo** | Telas nativas, um código para iOS e Android | Exige API; cada tela é feita de novo                                    |

A regra 4.3 (app repetido) pesa pouco em qualquer um: é um app só, de um produto só.

## Decisão

### Um projeto à parte em `apps/mobile`

- **Expo SDK 58, React Native 0.88, expo-router**, com a barra de abas nativa de cada sistema (`NativeTabs`).
  Os ícones das abas no Android vêm do `expo-symbols`: sem ele a barra não monta.
- **Fora do workspace pnpm** (`!apps/mobile` em `pnpm-workspace.yaml`), com `pnpm-workspace.yaml`, lockfile e
  `node_modules` próprios. O `Dockerfile` instala o workspace inteiro: com o app dentro, todo deploy do site
  baixaria o React Native. Fora, o build do Dokploy não muda. `nodeLinker: hoisted` é o que o Metro espera.
- **`ios/` e `android/` não são versionados.** `app.json` é a fonte, e `expo prebuild` gera as pastas. Abrir no
  Xcode: `pnpm prebuild` e depois `ios/OrganizeUp.xcworkspace`.
- **`pnpm check` da raiz** cobre o app em formatação e lint. Tipos: `pnpm typecheck` dentro de `apps/mobile`,
  depois de `pnpm install` lá. Quem não mexe no app não precisa instalar nada.

### API do app: `/api/mobile/v1`

Rotas novas em `apps/web`, que reaproveitam o que as telas já usam. Nenhuma regra de negócio foi copiada.

| Rota                 | O que faz                               | De onde vem                          |
| -------------------- | --------------------------------------- | ------------------------------------ |
| `GET me`             | Pessoa, família aberta e famílias       | `fromSession`, `listMemberships`     |
| `GET overview`       | Tela inicial do mês                     | `loadOverview`                       |
| `GET entries`        | Lançamentos do mês, contas e categorias | `loadMonth`                          |
| `POST entries`       | Lançamento novo                         | a action `saveEntry`, sem mudar nada |
| `GET notifications`  | Avisos                                  | `loadNotifications`                  |
| `POST notifications` | Marcar tudo como lido                   | a action `markAllRead`               |

- **`mobileTenant()`** (`lib/mobile-api.ts`) é o `requireTenant` do app: mesma sessão, mesma conferência de
  filiação, suspensão, manutenção e plano vencido. A diferença é responder JSON com um código (`401
unauthenticated`, `409 no_family`, `403 suspended`) em vez de redirecionar. O isolamento continua em
  `withHousehold` e na RLS (ADR-0002).
- **Dinheiro sai escrito.** A API devolve `amountText` já na moeda da família e no idioma da conta (`getMoney`).
  O app só mostra: não faz conta com valor, então a regra 4 do `AGENTS.md` não tem como ser quebrada lá.
- **Gravar passa pela action da tela.** `POST entries` monta o `FormData` e chama `saveEntry`: mesma validação,
  mesmo limite do plano (ADR-0023), mesma auditoria. O valor chega como a pessoa digitou.
- **Versão no caminho (`v1`).** App instalado não atualiza junto com o site. Mudança que quebra o formato vira
  `v2`, e a `v1` fica até os apps antigos saírem de uso.
- As rotas são da Base e estão em `plan-guard.test.ts` e no catálogo de diagnósticos.

### Entrar: Better Auth com o plugin do Expo

- **Servidor:** `expo()` nos plugins e `trustedOrigins: ["organizeup://"]`. Pedido de navegador vindo de outra
  origem continua recusado (403); foi conferido.
- **App:** `@better-auth/expo/client` guarda o cookie da sessão no cofre do aparelho (Keychain no iPhone,
  Keystore no Android) e o manda em cada pedido. O pote de cookies do sistema fica de fora.
- **Verificação em duas etapas** (ADR-0034) funciona: depois da senha, o app pede o código.
- **Família:** sessão nova não tem família aberta. Com uma só, o app abre sozinho; com várias, pergunta.
- **Versão fixa:** `@better-auth/expo` anda junto com `better-auth` (hoje 1.7.14 nos dois lados).

### O que fica no site, de propósito

- **Criar conta, recuperar senha e criar família** abrem o site no navegador do sistema. O cadastro pede
  documento e aceite dos termos, e não vale duplicar isso agora.
- **Apagar a conta** abre as configurações no site. A Apple (5.1.1(v)) exige apagar dentro do app quando o app
  cria conta; como não cria, o link atende. Se o cadastro entrar no app, apagar entra junto.
- **Assinatura não aparece no app.** Vender plano digital dentro do app exige a compra da Apple (regra 3.1.1)
  e a do Google. Com `billing_enabled` desligada isso não trava nada. Antes de ligar a cobrança, decidir:
  vender só pelo site, sem botão nem link no app, ou implementar a compra das lojas.
- **Investimentos, metas, aposentadoria, dívidas, importação e assistente** seguem só no site por enquanto. O
  Perfil tem o atalho "Abrir a versão completa no navegador".

### Telas da primeira versão

Entrar (com código de duas etapas), Início (saldo, recebido, gasto, a vencer, contas, cartões, últimos
lançamentos), Lançamentos do mês, Novo lançamento, Avisos e Perfil (trocar de família, sair). Claro e escuro,
com as cores da paleta do ADR-0044.

## Consequências

- **Toda tela do app precisa de rota na API.** É o custo de ser nativo. A regra: a rota chama a mesma função
  ou action da tela do site, nunca uma cópia.
- **Textos do app** ficam em `apps/mobile/src/lib/strings.ts`, só em português por enquanto. O que vem do
  servidor já chega no idioma da conta. Inglês e espanhol entram antes de publicar fora do Brasil (ADR-0020).
- **Auth é caminho de risco alto:** a mudança em `lib/auth.ts` é o plugin e a origem do app, nada mais.
- **Sem notificação push, biometria e modo offline** nesta versão. São os próximos passos naturais, e ajudam
  na regra 4.2.
- O que falta para publicar, e o que só o fundador pode fazer, está em `docs/runbooks/app-lojas.md`.
