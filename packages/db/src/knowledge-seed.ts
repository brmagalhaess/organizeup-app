// Base de conhecimento do assistente (ADR-0018). Esta lista é a fonte: o migrador grava cada trecho pelo
// `slug` a cada subida e tira do banco o que saiu daqui, então revisar é editar este arquivo.
//
// Regras de quem editar:
// - só entra o que foi conferido na fonte oficial citada, e `reviewedOn` é o dia dessa conferência;
// - o texto é escrito com as próprias palavras, sem copiar a fonte;
// - valor que muda todo ano leva o ano no texto;
// - sem recomendação de ativo: conceito e regra, nunca "compre" ou "venda" (CVM).
// O SRE abre a revisão anual (paperclip/agentes/sre.md).

export interface KnowledgeSeed {
  slug: string;
  topic: string;
  title: string;
  content: string;
  sourceName: string;
  sourceUrl: string;
  /** Dia em que o trecho foi conferido na fonte, AAAA-MM-DD. */
  reviewedOn: string;
}

const REVIEWED = "2026-11-01";

export const KNOWLEDGE_SEED: KnowledgeSeed[] = [
  {
    slug: "reserva-de-emergencia",
    topic: "reserva",
    title: "Reserva de emergência: para que serve e quanto guardar",
    content:
      "A reserva de emergência é o dinheiro separado para imprevistos, como conta médica, perda de emprego ou conserto em casa. Não existe um valor único: o ideal é cobrir alguns meses dos gastos da família, e metas de 1, 3 ou 6 meses de despesas aparecem como referência. O que importa é ela segurar as contas até o problema passar. Gastos previsíveis do ano, como impostos e matrículas, não contam como emergência e pedem planejamento próprio. Como o dinheiro precisa estar disponível na hora e sem perda, a orientação é deixá-lo em aplicação de baixo risco e alta liquidez, com resgate imediato. Na reserva, o objetivo é proteger o dinheiro, não buscar mais rendimento.",
    sourceName: "Portal do Investidor (CVM)",
    sourceUrl:
      "https://www.gov.br/investidor/pt-br/penso-logo-invisto/planejamento-e-gestao-de-reservas-financeiras",
    reviewedOn: REVIEWED,
  },
  {
    slug: "fgc-limite-2026",
    topic: "fgc",
    title: "FGC: limite da garantia por pessoa e por instituição em 2026",
    content:
      "Em 2026, o Fundo Garantidor de Créditos (FGC) garante até R$ 250 mil por pessoa, identificada pelo CPF ou CNPJ, em cada instituição associada ou conglomerado financeiro. O que a mesma pessoa tem em instituições do mesmo conglomerado é somado antes de aplicar o limite. Existe também um teto de R$ 1 milhão por pessoa para o total pago pelo FGC a cada período de 4 anos; investimentos feitos até 21/12/2017 ficam fora desse teto. Em conta conjunta, o limite de R$ 250 mil, ou o saldo se for menor, é dividido igualmente entre os titulares. Ficam fora da garantia ordinária, entre outros, a Letra Imobiliária Garantida (LIG), os títulos públicos, o Certificado de Recebíveis Imobiliários (CRI) e os títulos de capitalização.",
    sourceName: "Fundo Garantidor de Créditos (FGC)",
    sourceUrl: "https://www.fgc.org.br/en/sobre-garantia-fgc",
    reviewedOn: REVIEWED,
  },
  {
    slug: "fgc-titulos-bancarios",
    topic: "fgc",
    title: "Quais títulos bancários têm garantia do FGC",
    content:
      "Entre os títulos bancários, têm garantia do FGC a poupança, o CDB, o RDB, a LCI e a LCA. A Letra Financeira (LF) e a Letra Imobiliária Garantida (LIG) não têm, e quem oferece esses títulos precisa alertar o investidor sobre isso de forma expressa. Na LIG, a proteção principal vem do patrimônio de afetação: os bens dados em garantia ficam separados das dívidas do banco. Antes de contar com a garantia, vale conferir o nome exato do título, porque dois papéis do mesmo banco podem ter regras diferentes.",
    sourceName: "Portal do Investidor (CVM)",
    sourceUrl:
      "https://www.gov.br/investidor/pt-br/investir/tipos-de-investimentos/titulos-bancarios",
    reviewedOn: REVIEWED,
  },
  {
    slug: "inss-contribuicao-2026",
    topic: "inss",
    title: "Tabela de contribuição do INSS em 2026",
    content:
      "Tabela de 2026, da Portaria Interministerial MPS/MF nº 13, válida a partir da competência de janeiro. Empregado, doméstico e avulso têm alíquotas progressivas: 7,5% até R$ 1.621,00; 9% de R$ 1.621,01 a R$ 2.902,84; 12% de R$ 2.902,85 a R$ 4.354,27; e 14% de R$ 4.354,28 a R$ 8.475,55. O salário de contribuição máximo, o teto, é R$ 8.475,55. Contribuinte individual e facultativo pagam 20% sobre um valor entre R$ 1.621,00 e R$ 8.475,55, o que dá de R$ 324,20 a R$ 1.695,11 por mês. No plano simplificado, a alíquota é 11% sobre o salário mínimo, ou R$ 178,31. O facultativo de baixa renda e o MEI pagam 5% sobre o salário mínimo, ou R$ 81,05.",
    sourceName: "Instituto Nacional do Seguro Social (INSS)",
    sourceUrl:
      "https://www.gov.br/inss/pt-br/direitos-e-deveres/inscricao-e-contribuicao/tabela-de-contribuicao-mensal",
    reviewedOn: REVIEWED,
  },
  {
    slug: "inss-teto-beneficios-2026",
    topic: "inss",
    title: "Piso e teto dos benefícios do INSS em 2026",
    content:
      "Em 2026, o piso dos benefícios do INSS é R$ 1.621,00, igual ao salário mínimo, e o teto é R$ 8.475,55. Antes do reajuste, o teto era R$ 8.157,41. Os benefícios acima do salário mínimo tiveram reajuste de 3,9%, pelo INPC, com validade desde 1º de janeiro de 2026. Esses valores mudam todo ano, em janeiro. O teto limita o que o INSS paga: quem quer manter uma renda acima dele na aposentadoria precisa de outra fonte de renda além do benefício.",
    sourceName: "Ministério da Previdência Social",
    sourceUrl:
      "https://www.gov.br/previdencia/pt-br/noticias/2026/janeiro/beneficios-com-valor-acima-do-salario-minimo-sao-reajustados-em-3-9",
    reviewedOn: REVIEWED,
  },
  {
    slug: "inss-aposentadoria-regras-2026",
    topic: "inss",
    title: "Regras para se aposentar pelo INSS em 2026",
    content:
      "Regra geral: mulher com 62 anos de idade e 15 de contribuição; homem com 65 anos e 20 de contribuição. Para homens que começaram a contribuir antes de novembro de 2019, o mínimo é de 15 anos. Quem já contribuía antes de novembro de 2019 pode ter regras de transição. Em 2026, a idade progressiva é de 59 anos e 6 meses para mulheres e 64 anos e 6 meses para homens, com 30 e 35 anos de contribuição. Na regra dos pontos, a soma de idade e tempo de contribuição é 93 para mulheres e 103 para homens, com os mesmos tempos mínimos. Essas duas sobem a cada ano. O pedágio de 50% vale para quem estava a até dois anos de se aposentar em novembro de 2019 e não tem idade mínima. O pedágio de 100% exige o dobro do tempo que faltava em 2019 e idade de 57 anos para mulheres e 60 para homens. Qual regra vale depende do histórico de cada pessoa.",
    sourceName: "Instituto Nacional do Seguro Social (INSS)",
    sourceUrl:
      "https://www.gov.br/inss/pt-br/noticias/noticias/regras-de-transicao-mudam-os-requisitos-para-aposentadoria-em-2026",
    reviewedOn: REVIEWED,
  },
  {
    slug: "previdencia-tabela-progressiva-regressiva",
    topic: "previdencia",
    title: "Imposto na previdência privada: tabela regressiva e progressiva",
    content:
      "Na previdência complementar, a tabela regressiva cobra menos imposto quanto mais tempo o dinheiro ficou acumulado: 35% até 2 anos; 30% de mais de 2 até 4 anos; 25% de mais de 4 até 6; 20% de mais de 6 até 8; 15% de mais de 8 até 10; e 10% acima de 10 anos. Nela, o imposto retido é definitivo e não tem ajuste na declaração anual. Quem não escolhe a regressiva fica na tabela progressiva: no resgate, retém 15% na fonte, como antecipação do imposto acertado na declaração. Pelas regras da Lei 14.803/2024, a opção pela regressiva pode ser feita até receber o benefício ou pedir o primeiro resgate, e não tem volta, mesmo com portabilidade para outro plano.",
    sourceName: "Lei 11.053/2004 (Planalto)",
    sourceUrl: "https://www.planalto.gov.br/ccivil_03/_ato2004-2006/2004/lei/l11053.htm",
    reviewedOn: REVIEWED,
  },
  {
    slug: "pgbl-vgbl",
    topic: "previdencia",
    title: "PGBL e VGBL: qual a diferença",
    content:
      "O PGBL é um plano de previdência complementar aberta, e o VGBL é um seguro de pessoas, mas os dois servem para acumular dinheiro para o futuro. A principal diferença está no imposto. No PGBL, as contribuições podem ser deduzidas na declaração completa do imposto de renda, até 12% da renda bruta anual; em troca, o imposto no resgate ou na renda incide sobre o valor total recebido. No VGBL, as contribuições não são dedutíveis, e o imposto incide só sobre os rendimentos. Por isso, o PGBL costuma ser considerado por quem faz a declaração completa, e o VGBL por quem usa a declaração simplificada ou já passou do limite de 12%.",
    sourceName: "Superintendência de Seguros Privados (Susep)",
    sourceUrl:
      "https://www.gov.br/susep/pt-br/assuntos/meu-futuro-seguro/seguros-previdencia-e-capitalizacao/providencia-complementar-aberta/pgbl-vgbl",
    reviewedOn: REVIEWED,
  },
  {
    slug: "previdencia-deducao-12",
    topic: "previdencia",
    title: "Quem pode deduzir previdência privada no imposto de renda",
    content:
      "A dedução de contribuições para previdência privada no imposto de renda tem limite de 12% do total dos rendimentos computados na base de cálculo da declaração. Para deduzir, a pessoa também precisa contribuir para a previdência oficial, seja o regime geral (INSS) ou um regime próprio. Quem já recebe aposentadoria ou pensão desses regimes não precisa cumprir essa condição. Contribuição acima do limite não reduz o imposto daquele ano.",
    sourceName: "Lei 9.532/1997, art. 11 (Planalto)",
    sourceUrl: "https://www.planalto.gov.br/ccivil_03/leis/l9532.htm",
    reviewedOn: REVIEWED,
  },
  {
    slug: "fii-rendimentos-isencao",
    topic: "fii",
    title: "FII: quando os rendimentos são isentos de imposto",
    content:
      "Os rendimentos que um fundo de investimento imobiliário (FII) distribui a pessoa física são isentos de imposto de renda, na fonte e na declaração, quando três condições são cumpridas. As cotas precisam ser negociadas apenas em bolsa ou balcão organizado. O fundo precisa ter pelo menos 100 cotistas. E a pessoa não pode ter 10% ou mais das cotas, nem fazer parte de um grupo de pessoas ligadas que tenha 30% ou mais. A Medida Provisória 1.303/2025 chegou a tratar do tema, mas perdeu a vigência; em novembro de 2026 a isenção segue na Lei 11.033/2004.",
    sourceName: "Lei 11.033/2004, art. 3º (Planalto)",
    sourceUrl: "https://www.planalto.gov.br/ccivil_03/_ato2004-2006/2004/lei/l11033.htm",
    reviewedOn: REVIEWED,
  },
  {
    slug: "fii-venda-de-cotas",
    topic: "fii",
    title: "FII: imposto na venda de cotas",
    content:
      "O ganho na venda ou no resgate de cotas de fundo de investimento imobiliário (FII) paga imposto de renda de 20%. Quando a venda é em bolsa, a pessoa física calcula e paga como na compra e venda de ações em bolsa. Fora de bolsa, segue as regras de ganho de capital na venda de bens ou direitos. A alíquota de 20% também vale, com retenção na fonte pelo administrador, para os rendimentos do fundo que não têm direito à isenção.",
    sourceName: "Receita Federal",
    sourceUrl:
      "https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/pagamento/renda-variavel/fundos-de-investimento-no-brasil",
    reviewedOn: REVIEWED,
  },
  {
    slug: "dividendos-2026",
    topic: "dividendos",
    title: "Dividendos: o que mudou no imposto em 2026",
    content:
      "Desde janeiro de 2026, pela Lei 15.270/2025, a empresa que paga mais de R$ 50 mil em lucros e dividendos à mesma pessoa física no mês retém 10% de imposto na fonte. A retenção vale sobre o total pago no mês, não só sobre o que passou de R$ 50 mil. Até esse valor por empresa no mês, não há retenção. Ficam fora da retenção os lucros apurados até 2025, com distribuição aprovada até 31/12/2025 e paga nas condições aprovadas. A mesma lei criou um imposto mínimo anual para quem tem renda total acima de R$ 600 mil no ano, começando com os rendimentos de 2026, na declaração de 2027. A alíquota sobe aos poucos até 10%, a partir de R$ 1,2 milhão. O imposto já pago no ano, inclusive a retenção sobre dividendos, é descontado dessa conta.",
    sourceName: "Lei 15.270/2025 (Planalto)",
    sourceUrl: "https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/lei/l15270.htm",
    reviewedOn: REVIEWED,
  },
  {
    slug: "jcp-2026",
    topic: "dividendos",
    title: "Juros sobre capital próprio (JCP): imposto em 2026",
    content:
      "Os juros sobre capital próprio (JCP) pagos ou creditados ao acionista têm imposto de renda de 17,5% retido na fonte, desde 1º de janeiro de 2026, pela Lei Complementar 224/2025. Antes, eram 15%. Para pessoa física, a tributação é definitiva: o imposto é retido no pagamento ou no crédito e não há ajuste na declaração. Por isso, o valor líquido de JCP que cai na conta é menor que o valor bruto anunciado. Dividendos seguem outra regra, com retenção só acima de R$ 50 mil por mês da mesma empresa.",
    sourceName: "Lei 9.249/1995, art. 9º (Planalto)",
    sourceUrl: "https://www.planalto.gov.br/ccivil_03/leis/l9249.htm",
    reviewedOn: REVIEWED,
  },
  {
    slug: "inflacao-e-juro-real",
    topic: "inflacao",
    title: "Inflação e juro real",
    content:
      "Inflação é o aumento geral dos preços, e o indicador oficial dela no Brasil é o IPCA. Quando os preços sobem, o mesmo dinheiro passa a comprar menos: é a perda do poder de compra. Por isso, ao olhar quanto um investimento rendeu, o que mostra o ganho de verdade é o rendimento real, que é o que ficou acima do aumento geral dos preços. Se o dinheiro rendeu menos que a inflação, o saldo cresceu, mas ele compra menos do que antes. Títulos públicos atrelados ao IPCA pagam uma taxa fixa definida na compra mais a variação do índice.",
    sourceName: "Portal do Investidor (CVM)",
    sourceUrl:
      "https://www.gov.br/investidor/pt-br/investir/tipos-de-investimentos/titulos-publicos",
    reviewedOn: REVIEWED,
  },
  {
    slug: "diversificacao-e-risco",
    topic: "investimentos",
    title: "Diversificação, liquidez, risco e rentabilidade",
    content:
      "Todo investimento combina três características: liquidez, que é a facilidade de virar dinheiro por um valor justo; risco, que é a chance de perda; e rentabilidade, que é o retorno. As três nunca são boas ao mesmo tempo: desconfie de promessa de liquidez alta, risco baixo e rentabilidade alta juntos. Diversificar é dividir o dinheiro entre aplicações com características diferentes, como imóveis, renda fixa e renda variável, em vez de concentrar tudo em um só lugar. Isso ajuda a diminuir o risco, mas todo investimento continua tendo algum. Objetivos e prazos diferentes podem pedir aplicações diferentes, e rentabilidade passada não garante rentabilidade futura.",
    sourceName: "Banco Central do Brasil, Caderno de Educação Financeira (2026), Módulo 5",
    sourceUrl:
      "https://www.bcb.gov.br/content/cidadaniafinanceira/documentos_cidadania/Cuidando_do_seu_dinheiro_Gestao_de_Financas_Pessoais/v4_modulo_5_caderno_educacao_financeira_430206_2026.pdf",
    reviewedOn: REVIEWED,
  },
];
