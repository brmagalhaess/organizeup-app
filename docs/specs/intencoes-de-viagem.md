# Especificação — intenções de viagem

Pedido do fundador em 2026-11-02: "Em viagens o usuário pode cadastrar algumas intenções de viagens, e o agente pode usá-las
para sugerir a viagem seguindo os mesmos critérios." As decisões duráveis estão no ADR-0026.

## O que é

Bloco **Quero conhecer** em `/app/viagens`, antes das sugestões. A família lista lugares que quer conhecer, e o agente de viagens
dá preferência a eles quando cabem. Intenção é **dado informado** (regra 7): o agente lê e nunca muda nem apaga. Sugestão continua
só sugestão: nada entra no calendário sem aceitar.

## Campos

| Campo         | Obrigatório      | Regra                                                                                 |
| ------------- | ---------------- | ------------------------------------------------------------------------------------- |
| Destino       | sim              | Busca em `trip_destination_templates`, por nome ou país, sem diferenciar acento.      |
| Nome livre    | fora do catálogo | 1 a 80 caracteres. É texto da família: dado, nunca instrução. Igual a um destino, vira ele. |
| Região        | com nome livre   | Uma das regiões de `DestinationRegion`.                                               |
| Mês preferido | não              | Mês do ano, de janeiro a dezembro, sem ano.                                           |
| Dias          | não              | 1 a 60. Vazio: vale a regra atual (os dias da família, ou o mínimo do destino, ou 5). |

A tabela guarda o país em código ISO. A busca compara com o nome do país em português, inglês e espanhol, porque os nomes dos destinos
não são traduzidos.

Nome livre igual a um destino da tabela, sem contar acento, caixa e espaço, é gravado como esse destino, e aí a região não é necessária.

O mesmo destino, ou o mesmo nome livre, entra uma vez só por família, na mesma comparação. Quem tenta de novo lê que já está na lista.

## Situação de cada intenção

Só uma aparece por vez, nesta ordem. A linha da intenção sempre mostra destino, mês e dias.

| Situação       | Quando                                                      | O cartão diz                                                                            |
| -------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Atendida       | Aceitou a sugestão (`fulfilled_at`)                         | Selo "Atendida" e a viagem criada. Ainda dá para refazer ou remover.                    |
| Sugerida       | Há sugestão pendente dela                                   | Mês sugerido. A decisão fica no cartão de sugestão logo abaixo.                         |
| Recusada       | Recusou a sugestão de um ano                                | Até quando o assistente deixa de sugerir.                                               |
| Aguardando     | Nova, editada, ou a rodada não olhou                        | O assistente olha na próxima madrugada.                                                 |
| Não cabe       | Custo acima da parte de uma viagem no orçamento             | Custo, quanto guardar a mais por mês e, se houver, o primeiro mês em que o valor fecha. |
| Crianças       | Destino do catálogo não indicado para crianças              | Por que não sugere.                                                                     |
| Sem vaga       | Cabe, mas as viagens por ano já foram para outras intenções | Aumentar viagens por ano em Configurações › Plano abre a vaga.                          |
| Uma por ano    | `trips_per_year = 0`, e a sugestão do ano já saiu           | Volta no próximo ano, ou com viagens por ano em Configurações.                          |
| Sem estimativa | A tabela não tem destino para estimar                       | Por que não sugere.                                                                     |

A situação calculada pelo agente fica em `household_reports.data.intentions`, por id, sem nome. Editar a intenção volta para
Aguardando até a próxima rodada: a sugestão pendente dela sai, porque foi feita com os dados antigos.

## Primeiro uso e outros estados

- **Vazio:** texto curto que explica o bloco, com "Adicionar lugar". Quem só pode ver lê o mesmo texto, sem o botão.
- **Carregando:** a tela é do servidor. Salvar mostra "Salvando…" no botão, como os outros formulários do painel.
- **Erro:** mensagem no formulário, sem fechar. Falha de banco cai no erro da tela, como o resto do painel.
- **Banco atrasado:** sem a tabela, o bloco não aparece, e o resto de Viagens segue igual.
- **Visualizador:** vê tudo, sem adicionar, editar, remover ou refazer. A RLS recusa o que escapar.
- **Módulo desligado:** a tela já mostra o convite do módulo Metas, e as actions usam `requireModule("metas")`.
- **Família fora do real:** o bloco diz que o assistente não sugere nessa moeda, porque a tabela é em reais e para quem sai do Brasil,
  e não oferece adicionar. Intenção que já existia continua na lista, sem situação de agente, e pode ser removida.
- **Conta PJ:** mesmos textos, com o catálogo `messages/empresa` onde a frase fala de crianças.

## O que o agente faz

`suggestTrips`, em `packages/domain`, continua a única conta. Vale tudo o que já valia: estimativa, viajantes, duração, orçamento
mensal, mínimo de 4 meses, máximo de 36, boa época, meses ocupados, casamento e teto de `tripsPerYear`. O que muda:

- **Prioridade.** Intenção que cabe entra antes do catálogo. Entre elas, a mesma regra: as mais caras primeiro, regiões diferentes
  quando possível. O que sobrar de vaga segue o catálogo como hoje.
- **Sem intenção, o resultado é idêntico ao de antes,** provado por um teste contra uma cópia congelada da função antiga.
- **Mês preferido** é fixo quando dá tempo de guardar. Senão, o mesmo mês do ano seguinte, com nota. Uma viagem com mês preferido não
  muda para o mês do casamento.
- **Fora do catálogo.** Cada custo é a mediana da região na tabela, com `confidence = "baixa"`, e a sugestão diz que é estimativa pela
  região. A região `brasil_perto` ainda não tem linha na tabela: usa a mediana de `brasil`, e a nota diz a região usada.
- **Não cabe** é o critério do catálogo: custo maior que a parte de uma viagem no orçamento de um ano.
- **Recusar** não apaga a intenção e vale até o fim do ano da viagem recusada: recusou março de 2027, não volta nem para outro mês,
  nem em 2028, enquanto 2027 não acabar. O destino recusado também não vem pelo catálogo.
- **Aceitar** cria a viagem e marca a intenção como atendida. Aceitar é da família: não há botão de desfazer. Para voltar atrás, ela
  remove a viagem na tela de Viagens. Refazer tira a marca, a viagem criada continua, e a intenção volta à fila.
- **Sugestão genérica do mesmo destino.** Criar a intenção tira a pendente. Se a família aceitar uma que ainda estava na tela, a intenção
  fica atendida.
- **`trips_per_year = 0` com intenção aberta:** o agente trata como uma vaga só para intenção, sem catálogo, e cria no máximo uma
  sugestão por ano civil, contando as já decididas. Assim a intenção não fica ignorada, e quem disse zero não recebe catálogo.
- **Família fora do real:** o agente segue sem sugerir.

## Assistente

`listar_viagens` passa a trazer `intencoes`, com o nome livre marcado como `dado_nao_confiavel`, e só roda com o aceite atual, como
toda ferramenta. Nenhuma ferramenta nova, nenhuma de escrita.

## Fora do escopo

Prioridade definida pela família. Duas famílias, ou duas pessoas, com listas separadas. Tradução dos nomes do catálogo (ADR-0020).
Preço por destino fora do catálogo.
