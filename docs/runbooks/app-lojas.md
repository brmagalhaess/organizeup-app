# App nas lojas: como rodar e o que falta para publicar

App de celular do OrganizeUp (`apps/mobile`, ADR-0045). Nada aqui publica sozinho: enviar para as lojas é
sempre uma ação do fundador.

## Rodar no computador

```bash
cd apps/mobile
pnpm install                 # instalação própria, fora do workspace
cp .env.example .env.local   # aponta o app para o site local; sem isso, fala com a produção
pnpm ios                     # simulador do iPhone (precisa do Xcode)
pnpm android                 # emulador Android (precisa do Android Studio ou do SDK com um AVD)
```

- **Abrir no Xcode:** `pnpm prebuild` e depois abra `ios/OrganizeUp.xcworkspace`.
- **Site local:** `pnpm db:local` e `pnpm dev` na raiz. No emulador Android, antes:
  `adb reverse tcp:3000 tcp:3000` (ou a porta que estiver usando).
- **Conta de teste local:** `pnpm seed` cria uma conta e uma família fictícias no servidor local e guarda a
  senha em `.dev-account.json`, que o Git ignora. O script recusa qualquer endereço que não seja desta máquina.
- **Espaço em disco:** o primeiro build de cada sistema baixa e gera bastante coisa. Reserve uns 5 GB livres
  para o iOS e uns 8 GB para o Android (emulador, imagem do sistema e cache do Gradle).
- **NDK do Android:** o build pede o NDK 27.1. Se a pasta dele em `~/Library/Android/sdk/ndk` estiver vazia
  (instalação interrompida), reinstale pelo Android Studio, ou, para testar, ponha
  `ext { ndkVersion = "<versão instalada>" }` antes de `apply plugin: "expo-root-project"` no
  `android/build.gradle` gerado.
- **Ícones:** os SVG ficam em `assets/source`. Depois de mudar, gere os PNG de 1024 px em `assets/images`.

## O que só o fundador pode fazer

### Contas e identidade

1. **Apple Developer Program** (anual, pago), em nome de pessoa ou empresa. Como empresa pede número D-U-N-S.
2. **Google Play Console** (taxa única). Conta pessoal nova exige teste fechado com pelo menos 12 pessoas por
   14 dias antes de liberar a produção; conta de empresa não.
3. **Confirmar o identificador do app:** hoje `br.com.crowntech.organizeup` em `app.json`, nos dois sistemas.
   Depois de publicado não muda mais.
4. **Conta Expo (EAS)**, se quiser gerar os builds de loja na nuvem. Dá para gerar pelo Xcode e pelo Gradle sem
   ela.

### Assinatura e certificados

5. **iOS:** certificado de distribuição e perfil de provisionamento. O Xcode cria sozinho com "Automatically
   manage signing" depois de entrar com a conta de desenvolvedor.
6. **Android:** chave de envio (keystore). Guardar fora do repositório, com cópia de segurança: perder a chave
   complica toda atualização futura. Ativar o Play App Signing.

### Ficha das lojas

7. Nome, subtítulo, descrição, palavras-chave e categoria (Finanças), em português.
8. **Capturas de tela** do iPhone (6,9") e do Android, com dados fictícios.
9. **Política de privacidade:** o endereço público já existe (`/privacidade`). Conferir se o texto cobre o app.
10. **Questionário de privacidade da Apple** ("App Privacy") e **Segurança dos dados do Google**: o que o app
    coleta (e-mail, nome, dados financeiros informados pela pessoa), para quê, e que não há rastreamento nem
    anúncio.
11. **Classificação etária** nos dois consoles.
12. **Apps de finanças no Google Play:** preencher a declaração de recursos financeiros.
13. **Endereço de suporte** e e-mail de contato.

### Revisão

14. **Conta de demonstração para os revisores**, com dados fictícios e sem verificação em duas etapas. Sem ela a
    Apple reprova na hora (regra 2.1).
15. **Nota para a revisão** explicando que o cadastro é feito pelo site e que o app não vende nada.
16. **Enviar para revisão** e responder aos revisores.

## Riscos de reprovação e como estão tratados

| Regra da Apple                   | Risco | Situação                                                                    |
| -------------------------------- | ----- | --------------------------------------------------------------------------- |
| 4.2 Funcionalidade mínima        | Baixo | Telas nativas, não é o site numa moldura. Push e biometria reforçam         |
| 4.3 App repetido                 | Baixo | Um app só, de um produto só                                                 |
| 3.1.1 Compra dentro do app       | Baixo | O app não mostra planos nem link de compra. Rever antes de ligar a cobrança |
| 5.1.1(v) Apagar a conta          | Médio | Link para o site. Se o revisor pedir, trazer a exclusão para dentro do app  |
| 2.1 App incompleto ou sem acesso | Médio | Depende da conta de demonstração (item 14)                                  |

## Situação dos testes (16/11/2026)

- **iPhone (simulador, iOS 27):** entrar, senha errada, início, lançamentos, novo lançamento, avisos e perfil
  conferidos com a conta fictícia local. Depois de entrar o `expo-symbols`, o app foi recompilado e abre na tela
  de entrar; o fluxo completo não foi repetido nesse build.
- **Android (emulador, API 35):** entrar, início, lançamentos, avisos, perfil, novo lançamento com o seletor de
  data nativo, gravação pela API e sair, conferidos pelos elementos da tela e pelos registros do servidor. A
  imagem de emulador usada (ATD, sem janela) não devolve captura de tela, então o visual no Android ainda não
  foi olhado.

## O que falta no código antes de enviar

- Olhar o visual do app num Android com tela (emulador comum ou aparelho).

- Publicar a API (`/api/mobile/v1`) em produção: entra com o merge do PR do app.
- Testar num iPhone e num Android de verdade, com a conta real, contra a produção.
- Decidir se a primeira versão já leva notificação push de vencimento e desbloqueio por biometria.
- Inglês e espanhol, se a ficha da loja for publicada fora do Brasil.
- Número da versão e do build a cada envio (`version` em `app.json`).
