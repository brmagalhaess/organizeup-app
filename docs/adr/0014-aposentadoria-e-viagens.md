# ADR-0014 — Aposentadoria e viagens

Status: aceito (2026-10-30)

## Decisão

- **Aposentadoria em reais de hoje e retorno real.** Com renda desejada e retorno acima da inflação, o resultado faz
  sentido sem prever décadas de inflação. O patrimônio necessário é o valor presente da renda que falta, do dia de parar
  até a idade planejada. O aporte exigido é a série uniforme que chega lá.
- **Cenário guarda premissas, não resultado.** Tudo é recalculado a cada leitura, então a tela reflete a carteira de
  hoje. Por isso não há `projection_snapshots`, ao contrário do plano-mestre. Se a fórmula mudar e precisarmos comparar
  com o passado, a tabela entra.
- **INSS é informado pela família**, a partir do Meu INSS. As regras mudam e dependem do histórico de cada um.
- **Já guardado vazio usa a carteira inteira.** Quem separa parte dela informa o valor. FGTS e previdência entram por aí.
- **Retornos padrão de 4% e 2% ao ano** são só ponto de partida. A tela diz isso e não promete resultado. O cálculo
  ignora imposto.
- **Viagem** tem custos informados, por pessoa ou da viagem toda, e quem vai. O guardar por mês divide o que falta pelos
  meses até a viagem. O valor guardado é só controle e não mexe em conta.
- **A viagem entra no calendário** como evento, criado e apagado junto com ela.

## Fora do escopo por enquanto

Estimar custo de destino: sem fonte de dados, seria número inventado. Objetivos que não sejam viagem. Regra de INSS,
imposto na retirada e tábua de expectativa de vida.
