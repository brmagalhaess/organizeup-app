// Mensagens por chave (ADR-0020, Fase 3). Na mesma família, cada pessoa tem o seu idioma, então agentes e
// regras gravam a chave e os valores crus, e a tela formata no idioma de quem lê. Sem I/O e sem texto:
// o texto de cada chave fica em `apps/web/messages/{pt-BR,en,es}.json`, no grupo `agentes`.

import type { Currency } from "./money";

/** Linhas gravadas: cada chave tem `title` e `body` no catálogo. */
export const ROW_MESSAGE_KEYS = [
  "aporteReserva",
  "aporteDivida",
  "aporteDividaPlano",
  "aporteInvestimento",
  "lembreteRendimento",
  "lembreteRendimentoSimples",
  "lembreteAno",
  "lembretePlano",
  "categoriaMovida",
  "categoriaFusao",
  "categoriaSemPista",
  "proventoExcluido",
  "quantidadeConferir",
  "quantidadeAjustada",
  "valorSemInformar",
  "valorAntigo",
  "classeForaDaMeta",
  "proventosConferir",
  "mercadoDia",
  "metaForaDoPrazo",
  "metaSemOrcamento",
  "viagem",
  "assistenteReserva",
  "assistenteAposentadoria",
  "assistenteDataMeta",
  "assistenteMeta",
  "assistenteLembrete",
  "notificacaoMudanca",
  "notificacaoFusao",
  "notificacaoResumo",
  "relatorioCategorias",
  "relatorioImportacao",
  "relatorioInvestimentos",
  "relatorioInvestimentosVazio",
  "relatorioAposentadoria",
  "relatorioViagens",
  "relatorioMetas",
  "relatorioMetasPlano",
  "relatorioDividas",
  "relatorioDividasPlano",
  "assinaturaFalhou",
  "assinaturaRenovacao",
] as const;

/** Frases que entram em outra mensagem: cada chave é um texto só no catálogo. */
export const SENTENCE_MESSAGE_KEYS = [
  "frases.motivo",
  "frases.motivoRegra",
  "frases.motivoVisto",
  "frases.motivoAssistente",
  "frases.motivoNomesIguais",
  "frases.motivoPalavras",
  "frases.fusaoFeita",
  "frases.reservaFalta",
  "frases.reservaFecha",
  "frases.reservaAceitar",
  "frases.aposentadoriaIncompleta",
  "frases.aposentadoriaFecha",
  "frases.aposentadoriaPreciso",
  "frases.aposentadoriaMais",
  "frases.aposentadoriaMaisDe60",
  "frases.eventoAcoes",
  "frases.eventoAcoesNaFrase",
  "frases.classe",
  "frases.classeNaFrase",
  "frases.mercadoPrecos",
  "frases.mercadoProventos",
  "frases.mercadoAReceber",
  "frases.mercadoCorrigidos",
  "frases.mercadoRetirados",
  "frases.metaGuardar",
  "frases.metaSemEspaco",
  "frases.metaPrecisa",
  "frases.metaAceitar",
  "frases.metaReduza",
  "frases.notaMeta",
  "frases.notaConquistada",
  "frases.notaPausada",
  "frases.notaSemOrcamento",
  "frases.notaSemOrcamentoReduza",
  "frases.notaLonga",
  "frases.notaDataPassou",
  "frases.notaNaoCabe",
  "frases.notaComeca",
  "frases.notaEscolhaConta",
  "frases.notaParcelaAjustada",
  "frases.viagemQuando",
  "frases.viagemCusto",
  "frases.viagemGuarde",
  "frases.viagemPede",
  "frases.viagemFonte",
  "frases.viagemGuardeMais",
  "frases.viagemCasamento",
  "frases.viagemBoaEpoca",
  "frases.notificacaoLancamentos",
  "frases.relCategorias",
  "frases.relCategoriasCriadas",
  "frases.relCategoriasIa",
  "frases.relImportacao",
  "frases.relImportacaoCriadas",
  "frases.relImportacaoCorrigiu",
  "frases.relImportacaoDesfeita",
  "frases.relCarteira",
  "frases.relCarteiraRende",
  "frases.relValorAtualizar",
  "frases.relAtualizadoHoje",
  "frases.relQuantidades",
  "frases.relAReceber",
  "frases.relPrevisao",
  "frases.relSobra",
  "frases.relSobraBasePrevista",
  "frases.relSobraBaseMeses",
  "frases.relPlanoCoberto",
  "frases.relPlanoIncompleto",
  "frases.relViagensSemPedido",
  "frases.relViagensSemDivisao",
  "frases.relViagensSemPessoas",
  "frases.relViagensForaDoBrasil",
  "frases.relViagensNenhuma",
  "frases.relViagensSugeridas",
  "frases.relViagensPedem",
  "frases.relMetasNenhuma",
  "frases.relMetasSemDivisao",
  "frases.relDividasNenhuma",
  "frases.relDividasNaoTerminam",
  "frases.relDividasQuite",
  "frases.relDividasQuiteEconomize",
  "frases.relDividasTotal",
  "frases.relDividasComece",
  "frases.relDividasSemExtra",
  "frases.relDividasMudou",
  "frases.relDividasAtencao",
] as const;

export type RowMessageKey = (typeof ROW_MESSAGE_KEYS)[number];
export type SentenceMessageKey = (typeof SENTENCE_MESSAGE_KEYS)[number];
export type MessageKey = RowMessageKey | SentenceMessageKey;

/**
 * Valor de uma mensagem. Texto e número vão como estão: nome digitado pela família não é traduzido.
 * Os demais dizem à tela como formatar: dinheiro com a moeda (sem ela, real), mês `AAAA-MM`, data `AAAA-MM-DD`, percentual
 * de 0 a 100, quantidade de cotas, número do mês, nome de categoria e frases dentro da frase.
 */
export type MessageValue =
  | string
  | number
  | { money: string; currency?: Currency }
  | { month: string }
  | { date: string }
  | { percent: number }
  | { quantity: string }
  | { monthName: number }
  | { category: string }
  | { categories: string[] }
  | { message: Message }
  | { messages: Message[]; separator?: string };

export type MessageParams = Record<string, MessageValue>;

export interface Message<K extends MessageKey = MessageKey> {
  key: K;
  params?: MessageParams;
}

/** Dinheiro cru de uma mensagem. A moeda só vai fora do real: linha em real continua igual. */
export const moneyValue = (value: string, currency: Currency = "BRL"): MessageValue =>
  currency === "BRL" ? { money: value } : { money: value, currency };

/** Mensagem de uma chave conhecida: chave errada não compila. */
export const message = <K extends MessageKey>(key: K, params?: MessageParams): Message<K> =>
  params ? { key, params } : { key };

/** Frases em sequência, numa frase só. */
export const sentences = (items: Message[], separator?: string): MessageValue =>
  separator === undefined ? { messages: items } : { messages: items, separator };
