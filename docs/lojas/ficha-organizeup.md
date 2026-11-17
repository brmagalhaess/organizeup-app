# Fichas do OrganizeUp na App Store e no Google Play

Textos e respostas para colar nos dois consoles. Tudo em português do Brasil. Os limites de tamanho de cada campo
estão entre parênteses e já foram conferidos.

As imagens ficam em `docs/lojas/imagens/`. Foram tiradas no simulador com uma família fictícia ("Família
Exemplo") criada só no ambiente local. Nenhum dado real aparece nelas. Para refazer depois de mudar o app:
capturar as telas de novo (`xcrun simctl io <aparelho> screenshot raw-01-inicio.png` etc.) e rodar
`python3 docs/lojas/montar-imagens.py <pasta-das-capturas> apps/mobile/assets/images/icon.png docs/lojas/imagens`.

## Dados que valem para as duas lojas

| Campo                     | Valor                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| Nome do app               | OrganizeUp                                                             |
| Identificador             | `br.com.crowntech.organizeup`                                          |
| Categoria                 | Finanças                                                               |
| Preço                     | Gratuito, sem compras dentro do app e sem anúncios                     |
| Política de privacidade   | https://organizeup.crowntech.com.br/privacidade                        |
| Termos de uso             | https://organizeup.crowntech.com.br/termos                             |
| Site                      | https://organizeup.crowntech.com.br                                    |
| Suporte                   | suporte@crowntech.com.br · https://organizeup.crowntech.com.br/suporte |
| Direitos autorais (Apple) | 2026 CrownTech LTDA                                                    |

**Suporte:** a página `/suporte` do site mostra o e-mail e serve de endereço de suporte nas duas lojas.

## App Store (App Store Connect)

**Nome** (30): `OrganizeUp`

**Subtítulo** (30): `Finanças da família em dia`

**Texto promocional** (170, pode mudar sem nova versão):

> Veja o saldo da família, o resumo do mês e o que vence nos próximos dias. Lance um gasto ou uma receita em
> segundos, onde estiver.

**Palavras-chave** (100, separadas por vírgula, sem espaço):

```
orçamento,gastos,despesas,receitas,controle financeiro,família,cartão,fatura,contas,planejamento
```

**Descrição** (4000):

```
O OrganizeUp é o app da sua família para acompanhar o dinheiro no dia a dia. Ele mostra os mesmos números do
painel do OrganizeUp no site, no bolso, e deixa você lançar um gasto ou uma receita na hora em que acontece.

NO INÍCIO
• Saldo de todas as contas da família somado, e quanto deve sobrar no fim do mês.
• Resumo do mês: quanto entrou, quanto saiu e o resultado.
• O que ainda vai vencer ou entrar, com a fatura do cartão já calculada.
• Contas e cartões com o saldo e a fatura de cada um.

LANÇAMENTOS
• Todos os lançamentos do mês, mês a mês.
• Novo lançamento em poucos toques: receita ou despesa, valor, data, categoria e conta.
• O que é previsto aparece marcado, para você saber o que ainda não aconteceu.

AVISOS
• Contas a vencer, mudanças feitas pelos assistentes e lembretes da família num só lugar.

FEITO PARA A FAMÍLIA
• Cada pessoa entra com a própria conta e vê a mesma família.
• Quem participa de mais de uma família troca entre elas no perfil.
• Verificação em duas etapas para quem ligou o recurso no site.

SEGURANÇA E PRIVACIDADE
• Conexão protegida do começo ao fim.
• Não vendemos seus dados e não mostramos anúncios.
• Seus dados financeiros não são usados para publicidade.

COMO COMEÇAR
O cadastro e o plano são feitos no site organizeup.crowntech.com.br. Depois é só entrar no app com o mesmo
e-mail e senha.
```

**Novidades desta versão** (4000):

> Primeira versão do OrganizeUp no celular: início com saldo e resumo do mês, lançamentos, avisos e perfil.

### Privacidade do app (App Privacy)

Pergunta inicial: "Você ou seus parceiros coletam dados deste app?" → **Sim**.

| Tipo de dado (Apple)                         | Uso                   | Ligado à pessoa | Rastreamento |
| -------------------------------------------- | --------------------- | --------------- | ------------ |
| Informações de contato → Nome                | Funcionalidade do app | Sim             | Não          |
| Informações de contato → E-mail              | Funcionalidade do app | Sim             | Não          |
| Informações financeiras → Outras informações | Funcionalidade do app | Sim             | Não          |
| Identificadores → ID do usuário              | Funcionalidade do app | Sim             | Não          |

Não marcar: localização, contatos, fotos, histórico de navegação, diagnóstico, dados de uso para análise,
publicidade. O app não tem SDK de terceiros de análise, anúncio ou relatório de falhas.

"Outras informações financeiras" são os lançamentos, contas, cartões e saldos que a pessoa informa. O app não
lê cartão de pagamento nem conta bancária.

### Classificação etária

Responder **Nenhum** ou **Não** em todas as perguntas (violência, conteúdo sexual, jogos de azar, conteúdo
gerado por usuários público, conversa entre usuários, compras, acesso livre à internet). Resultado esperado:
**4+**.

### Nota para a revisão

Campo "Notes" em App Review Information:

```
OrganizeUp is a family budgeting app. Accounts and subscriptions are created on our website
(organizeup.crowntech.com.br); the app does not sell anything and shows no prices or purchase links.

Use the demo account below. It belongs to a fictional family with fictional data and does not use two-step
verification. After signing in you will see: Home (balance, monthly summary, accounts and cards), Entries
(list by month and the + button to add an entry), Notices and Profile (switch family, sign out, delete
account on the website).
```

Os campos "User name" e "Password" levam a conta de demonstração que o fundador cria na produção (ver
`docs/runbooks/app-lojas.md`, item 14). Não colocar e-mail nem senha neste arquivo.

### Imagens da App Store

- iPhone 6,9": `imagens/ios-6.9/01-inicio.png` até `06-perfil.png` (1320 × 2868). A Apple reduz para os
  outros tamanhos de iPhone.
- iPad: não precisa, o app é só para iPhone (`supportsTablet: false`).

## Google Play (Play Console)

**Nome do app** (30): `OrganizeUp: orçamento familiar`

**Descrição curta** (80):

```
Saldo, resumo do mês e lançamentos da sua família, sempre à mão.
```

**Descrição completa** (4000): o mesmo texto da App Store acima.

**Recursos gráficos:**

| Item                 | Arquivo                               | Tamanho     |
| -------------------- | ------------------------------------- | ----------- |
| Ícone                | `imagens/play/icone-512.png`          | 512 × 512   |
| Gráfico de destaque  | `imagens/play/destaque-1024x500.png`  | 1024 × 500  |
| Capturas do telefone | `imagens/play/01-inicio.png` até `06` | 1080 × 1920 |

As capturas do Google foram feitas no simulador do iPhone (o emulador Android desta máquina não tem janela). O
Google pede que as imagens mostrem o app de verdade, e a barra de cima é a do iPhone. Servem para a primeira
versão; quando der para rodar o app num Android com tela, trocar por capturas do Android com o mesmo script.

### Configuração do app (painel "Configurar o app")

| Pergunta                         | Resposta                                                                 |
| -------------------------------- | ------------------------------------------------------------------------ |
| Acesso ao app                    | Parte do app tem acesso restrito. Informar a conta de demonstração       |
| Anúncios                         | Não, o app não tem anúncios                                              |
| Classificação do conteúdo        | Categoria "Utilitário, produtividade, comunicação ou outro". Não em tudo |
| Público-alvo                     | 18 anos ou mais                                                          |
| App de notícias                  | Não                                                                      |
| Rastreamento de contatos (COVID) | Não                                                                      |
| Apps governamentais              | Não                                                                      |
| Recursos financeiros             | Ver abaixo                                                               |
| Saúde                            | Não                                                                      |
| ID de publicidade                | Não usa                                                                  |

**Recursos financeiros:** o app só mostra e registra o que a família informa. Não empresta dinheiro, não
movimenta dinheiro, não guarda cartão, não é banco nem corretora e não lida com criptomoeda. No formulário,
marcar só a opção de **gestão de finanças pessoais / orçamento** (o nome exato da opção pode mudar no console).
Se houver a opção "Meu app não oferece recursos financeiros" e não houver a de orçamento, usar essa.

### Segurança dos dados (Data safety)

| Pergunta                                  | Resposta                       |
| ----------------------------------------- | ------------------------------ |
| O app coleta ou compartilha dados?        | Sim, coleta                    |
| Os dados são criptografados em trânsito?  | Sim                            |
| A pessoa pode pedir a exclusão dos dados? | Sim, no site, em Configurações |
| Compartilha dados com terceiros?          | Não                            |

| Tipo de dado (Google)                        | Coletado | Obrigatório | Finalidade                             |
| -------------------------------------------- | -------- | ----------- | -------------------------------------- |
| Informações pessoais → Nome                  | Sim      | Sim         | Funcionalidade do app, gestão da conta |
| Informações pessoais → Endereço de e-mail    | Sim      | Sim         | Funcionalidade do app, gestão da conta |
| Informações pessoais → IDs do usuário        | Sim      | Sim         | Funcionalidade do app, gestão da conta |
| Informações financeiras → Outras informações | Sim      | Sim         | Funcionalidade do app                  |

Nenhum dado é processado só no aparelho e descartado; tudo vai para o servidor da família. Não marcar
localização, contatos, fotos, arquivos, histórico de navegação, informações do app e desempenho, nem ID do
aparelho.

**Endereço para pedir exclusão da conta** (o Google exige um link):
https://organizeup.crowntech.com.br/suporte#apagar-conta (passos, o que é apagado e o que fica, como o Google pede).

## Antes de enviar para revisão

1. Fundador aceita o contrato novo da Apple e cria o app no App Store Connect.
2. Página `/suporte` publicada no site (este PR).
3. Fundador roda `node scripts/conta-revisao.mjs` em `apps/mobile`: cria a conta de demonstração na produção,
   sem verificação em duas etapas, e guarda e-mail e senha em `~/.organizeup/conta-revisao.json`. Depois libera
   a conta em `/admin/vip`, para ela não ficar só para leitura quando o teste grátis acabar.
4. Pacotes do app gerados (iOS pelo Xcode, Android `.aab`) com internet que alcance a Cloudflare.
5. Fichas preenchidas com este arquivo e as imagens. O envio para revisão só com o ok do fundador.
