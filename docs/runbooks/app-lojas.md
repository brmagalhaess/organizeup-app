# App nas lojas: como rodar e o que falta para publicar

App de celular do OrganizeUp (`apps/mobile`, ADR-0045). Nada aqui publica sozinho: enviar para as lojas é
sempre uma ação do fundador.

## Rodar no computador

```bash
cd apps/mobile
pnpm install                 # instalação própria, fora do workspace
cp .env.example .env.local   # só em desenvolvimento: aponta o app para o site local; sem isso, produção
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
  (instalação interrompida), reinstale pelo Android Studio ou passe outra versão instalada:
  `ORGANIZEUP_NDK=28.1.13356709 pnpm loja:android` (o ajuste fica em `plugins/android-loja.js`).
- **Servidor:** em desenvolvimento o app usa `EXPO_PUBLIC_API_URL` do `.env.local`. O build de loja ignora
  essa variável e fala sempre com a produção (`src/lib/config.ts`).
- **Ícones:** os SVG ficam em `assets/source`. Depois de mudar, gere os PNG de 1024 px em `assets/images`.

## Gerar os pacotes de loja

Os dois comandos rodam dentro de `apps/mobile` e recriam as pastas `ios/` e `android/` do zero.

**iPhone (App Store):**

1. `pnpm loja:ios` abre o Xcode.
2. Em **Signing & Capabilities**, escolha o seu time (a conta do Apple Developer Program).
3. No topo, destino **Any iOS Device (arm64)**.
4. **Product > Archive**. Ao terminar, **Distribute App > App Store Connect > Upload**.
5. O build aparece no App Store Connect em uns 15 minutos. Dá para testar no seu iPhone pelo TestFlight antes
   de mandar para a revisão.

**Android (Google Play):**

1. Uma vez só: `bash scripts/chave-android.sh` cria a chave de envio em `~/.organizeup` e diz as quatro linhas
   para pôr em `~/.gradle/gradle.properties` (com a senha que você escolheu). Faça cópia de segurança da pasta.
2. `pnpm loja:android` gera `android/app/build/outputs/bundle/release/app-release.aab`.
3. Na Play Console: crie o app, ative o **Play App Signing** e envie o `.aab` em **Teste interno** primeiro.

A cada nova versão, suba `version` e os números de build em `app.json` (`ios.buildNumber` e
`android.versionCode`, sempre maiores que o anterior).

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
6. **Android:** chave de envio, criada com `scripts/chave-android.sh`. Fica fora do repositório; guarde cópia.
   Ativar o Play App Signing.

### Ficha das lojas

Textos, respostas dos formulários e imagens prontos em `docs/lojas/ficha-organizeup.md`.

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

14. **Conta de demonstração para os revisores**, criada por você na produção, com família e dados fictícios e
    **sem** verificação em duas etapas (os revisores não têm o seu autenticador). Sem ela a Apple reprova na
    hora (regra 2.1). E-mail e senha vão só no campo "Sign-in required" do App Store Connect e da Play Console.
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
  conferidos com a conta fictícia local.
- **Verificação em duas etapas:** conferida no simulador com uma conta fictícia local que tem o recurso ligado:
  senha, tela do código, troca para código de reserva e volta, código do autenticador aceito e painel aberto.
  Quem não ligou o recurso entra só com e-mail e senha, como no site.
- **Produção:** o servidor aceita o login vindo do app (teste com e-mail inexistente devolve "senha inválida", não
  "origem recusada"). O simulador foi apontado para a produção e abre o site certo; o login com uma conta real
  é feito pelo fundador, que digita a própria senha.
- **Android (emulador, API 35):** entrar, início, lançamentos, avisos, perfil, novo lançamento com o seletor de
  data nativo, gravação pela API e sair, conferidos pelos elementos da tela e pelos registros do servidor. O
  visual no Android ainda não foi olhado (imagem de emulador sem janela).

## O que falta antes de enviar

- Login com a conta real na produção, pelo fundador (simulador ou TestFlight).
- Olhar o visual do app num Android com tela (emulador comum ou aparelho).
- Decidir se a primeira versão já leva notificação push de vencimento e desbloqueio por biometria.
- Inglês e espanhol, se a ficha da loja for publicada fora do Brasil.
