# ADR-0026 — Intenções de viagem

Status: aceito (2026-11-02). Pedido do fundador: "Em viagens o usuário pode cadastrar algumas intenções de viagens, e o agente pode
usá-las para sugerir a viagem seguindo os mesmos critérios." Campos, estados e primeiro uso estão em
`docs/specs/intencoes-de-viagem.md`.

Soma ao ADR-0015 (agentes e dado informado), ao ADR-0020 (idiomas e moedas), ao ADR-0023 (módulos). Não muda nenhum critério de
viagem do ADR-0015.

## Decisão

### Ordem do deploy

O primeiro commit é só a migração `0039`, sem grants próprios: a tabela é de tenant, cabe no GRANT geral, e a RLS (FORCE) restringe.
Sozinho, deixa o `pnpm check` vermelho no teste que confere se toda tabela com `household_id` entra na exportação, como a `0036`.

Todo o resto funciona com o banco atrasado, e `atraso.integration.test.ts` prova isso como `ou_app`:

- **`trip_intentions` é tabela nova:** nenhum `select()` de outra tabela passa a ler coluna que falte.
- **O agente e `listar_viagens` leem num savepoint** (`loadTripIntentions`). Sem a tabela, a lista vem vazia e a transação segue viva.
  Por isso a leitura fica fora de `Promise.all`: savepoint não divide conexão com outra consulta.
- **A tela** usa `tolerateSchemaLag`: sem a tabela, o bloco não aparece.
- **A exportação** entra em `LATE_TABLES`, com savepoint próprio.

### Dado informado

A intenção é da família. O agente nunca muda nem apaga, e o teste confere a linha igual antes e depois de rodar. Só o **aceite** grava
`fulfilled_at` e `fulfilled_trip_id`, dentro de `applySuggestion`, no contexto de quem aceitou. Desfazer limpa. Sugestão pendente é dado
derivado: editar ou remover a intenção tira a pendente na mesma transação, porque aceitar uma sugestão feita com os dados antigos
criaria a viagem errada.

### Uma conta só

`suggestTrips` continua a função pública, e agora delega para `planTrips`, que faz a mesma conta e também diz o que aconteceu com cada
intenção. Sem intenção, o caminho é o de antes: `trip-suggest-antes.ts`, cópia congelada do commit `51335bc`, é comparada com
`toStrictEqual` em 300 famílias geradas por fast-check. Chave de objeto nova só aparece em sugestão de intenção.

- **Cabe = o critério do catálogo:** custo até a parte de uma viagem no orçamento de um ano. Quem cabe entra antes do catálogo, com a
  mesma escolha (as mais caras, regiões diferentes). Vaga que sobra vai para o catálogo, com o mesmo código. Quando nem o catálogo cabe,
  vale o de sempre: a mais barata, com nota. A intenção que não coube fica no cartão, não vira essa nota.
- **Destino que é intenção não vem pelo catálogo,** em nenhuma situação. Senão a recusa de Lisboa voltaria como sugestão genérica de
  Lisboa. Vale inclusive para atendida.
- **Mês preferido entra primeiro na busca de meses,** para nenhuma viagem mais barata tomar o lugar dele. Viagem com mês preferido não
  muda para o mês do casamento: a família disse o mês. Ela pode cair lá se o mês for esse.
- **Teto de 36 meses vale inteiro para intenção,** até na procura da boa época. O catálogo pode passar disso nesse passo, e não mudou:
  mudar quebraria a igualdade provada. Sem mês livre em 36 meses, a intenção fica com `sem_vaga`, sem sugerir por cima de outra viagem.
- **"Primeiro mês em que cabe"** não é um mês em que o agente vai sugerir. É quando o orçamento de hoje, só para ela, junta o valor, entre
  4 e 36 meses, pulando mês ocupado. Se fosse critério para sugerir, intenção cara passaria na frente com regra mais fraca que a do
  catálogo. O cartão diz as duas coisas: quanto guardar a mais para caber, e esse mês.
- **Quanto guardar a mais** usa a conta certa: `custo × viagens por ano ÷ 12 − orçamento`, com o centavo para cima. A nota antiga do
  catálogo divide por 12 sem olhar as viagens por ano, e só acerta com uma por ano. Ela não mudou, pela igualdade. Um teste de propriedade
  confere que somar o valor do cartão ao orçamento faz a viagem caber.

### Fora do catálogo

Cada custo é a mediana da região, separado (hospedagem, alimentação, transporte, passagem), por `money`. Número par de linhas: média dos
dois do meio. Dias: a mediana de `min_days`, para cima. Confiança sempre `baixa`. Sem saber o lugar, não há boa época nem restrição para
crianças. A sugestão guarda `regionEstimate`, e a tela escreve a fonte no idioma de quem lê, porque o texto é nosso e não da tabela.

**`brasil_perto` não tem linha na tabela** (todas as cinco de Brasil estão em `brasil`). Mantivemos a região no cadastro, como pedido, e
ela usa a mediana de `brasil`. Isso erra para mais em viagem de carro, porque leva passagem aérea, e a nota diz a região usada. Inventar
um número seria pior (ADR-0014). Região sem nenhuma linha, nem a de reserva, fica com `sem_estimativa` e o cartão explica.

### Recusa

- **Chave própria:** `viagem:intencao:<id>:<ano>`. A chave genérica `viagem:<destino>:<ano>` carregaria a recusa antiga de um destino
  genérico para o desejo que a família escreveu depois.
- **Vale até o fim do ano da viagem recusada,** não 30 dias, e não só aquele mês. Recusou março de 2027 em novembro de 2026: nada até 2028. Sem isso, a sugestão voltaria no dia seguinte para outro mês, ou para março de 2028. O texto de "Agora não" muda nesse caso, nas
  duas telas. `desfeita` conta como recusa.
- **Remover e cadastrar de novo** zera a recusa: é um gesto explícito da família.

### `trips_per_year = 0`

Quem diz zero hoje não recebe nada. Com intenção aberta, ignorar a lista contraria o pedido, e usar o catálogo contraria o zero. O
menor comportamento coerente: conta como **uma vaga só para intenção, sem catálogo**, e cria no máximo **uma sugestão por ano civil**,
contando as que a família já decidiu naquele ano. As outras intenções ficam com `sem_vaga`, depois `uma_por_ano`, e o cartão aponta para
Configurações. Intenção atendida ou recusada não conta como pedido: nesse caso o relatório continua dizendo `sem_pedido`.

### Onde mora a situação

O agente guarda em `household_reports.data.intentions` o resultado por id, com o `updated_at` que ele leu. Sem nome de destino, e sem
coluna derivada em `trip_intentions`, que é dado informado. A tela junta com o que é mais novo que o relatório: aceite, sugestão pendente,
recusa. Intenção editada depois da rodada volta para "aguardando". Sem isso o cartão mostraria um motivo de outra versão.

### Assistente e texto livre

`listar_viagens` traz `intencoes`, com nome livre em `untrusted`, e só roda com o aceite atual, como toda ferramenta. Nenhuma ferramenta
nova, então o limite de 20 `strict` não muda. Depois de virar sugestão, o nome segue os caminhos de sempre: título em `sugestoes_pendentes`,
também `untrusted`. Depois de aceito, é `trips.destination`, igual a uma viagem digitada. A action limpa quebra de linha e caractere de
controle, e `audit_log` guarda só o id. O relatório da família leva o nome em `suggestions`, como já levava o destino; `ops` não.

### Módulo e `ops`

Tudo sob o módulo Metas, que já cobre Viagens no ADR-0023: tela, actions e `listar_viagens`. `tripIntentions` entra em `MODULE_TABLES` de
`plan-guard.test.ts`.

`ops.agent_runs` ganha uma linha por dia, `viagens-intencoes`, sem coluna nova: `households` são as famílias com intenção, e `suggestions`,
as intenções usadas. Coluna nova em `agent_runs` faria a web cair lendo as rodadas com o banco atrasado (o mesmo motivo da `0028`). Não é um
agente: fica fora de `DAILY_AGENTS`, nada acorda essa linha, e `/admin/agentes` não a mostra.

**Nome com hífen.** O CHECK da `0016` aceita `^[a-z0-9-]{1,40}$`. Com sublinhado, o insert falhava todo dia, só com uma linha de log sem
código. O mesmo acontecia com o agente de IA de categorias, que por isso passou de `categorias_ia` para `categorias-ia`: sem a linha, a rede
de segurança das 05:30 repetia essa etapa todo dia, e o painel a dava como faltando. Não há linha antiga no banco, porque nenhuma entrou.
O que guardava o nome antigo segue valendo: a chave `agente_desligado:categorias_ia` conta como desligado até o painel gravar a nova, e
`POST /api/ops/agents` ainda aceita o nome de antes. `apps/worker` ganhou integração própria, com a rodada de verdade.

## Fora do escopo por enquanto

Prioridade escolhida pela família. Custo informado pela família para destino fora do catálogo. Linhas de `brasil_perto` na tabela.

## Riscos aceitos

- **Estimativa pela região é grosseira.** A tela diz isso, com confiança baixa, e nada é criado sem aceitar.
- **Recusa longa.** Quem recusa em janeiro uma viagem do ano seguinte espera quase dois anos, a não ser que remova e cadastre de novo.
  O cartão diz o ano.
- **Duas viagens no mesmo ano com `trips_per_year = 0`.** O limite conta o ano em que a sugestão nasceu. Uma de dezembro para abril e uma
  de janeiro para agosto caem no mesmo ano de viagem. Só acontece com aceite nas duas.
- **Mês preferido mais adiado que um ano.** Sem espaço no ano seguinte, a viagem vai mais adiante, ou cai no primeiro mês que caiba, com a
  nota. É raro: pede muitas viagens por ano com orçamento justo.
- **Apagar a viagem não reabre a intenção.** Ela fica atendida, com aviso, até a família usar Refazer. Reabrir sozinha faria o agente
  voltar a sugerir um lugar que a família acabou de tirar, ou que já visitou e só limpou da lista.
