// Formatação das telas do painel, sempre no servidor e no horário de Brasília.
const TIME_ZONE = "America/Sao_Paulo";

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: TIME_ZONE });
const dateTimeFormat = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: TIME_ZONE,
});
const numberFormat = new Intl.NumberFormat("pt-BR");

const usdFormat = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });

/** Para gastos por dia e por rota, que costumam ficar abaixo de um centavo. */
const usdFineFormat = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 4,
});

export const formatCount = (value: number) => numberFormat.format(value);
export const formatUsd = (value: number) => usdFormat.format(value);
export const formatUsdFine = (value: number) => usdFineFormat.format(value);
export const formatDate = (value: Date) => dateFormat.format(value);
export const formatDateTime = (value: Date) => dateTimeFormat.format(value);

/** "2026-10-31" → "31/10/2026", sem passar por Date para não mudar de dia com o fuso. */
export const formatDay = (day: string) => day.split("-").reverse().join("/");

/** Id encurtado para reconhecer uma conta sem mostrar nome nem e-mail. */
export const shortId = (id: string) => id.slice(0, 8);

const ROLE_LABELS: Record<string, string> = {
  owner: "Responsável",
  adult: "Adulto",
  child: "Criança",
  viewer: "Leitura",
};
export const roleLabel = (role: string) => ROLE_LABELS[role] ?? role;

/** Dia e mês curtos, para eixos de gráfico: "2026-10-26" → "26/10". */
export const formatDayShort = (day: string) => day.slice(5).split("-").reverse().join("/");

/** Os últimos dias do calendário (`YYYY-MM-DD`), do mais antigo ao de hoje. */
export function lastDays(today: string, total: number) {
  const base = new Date(`${today}T12:00:00Z`).getTime();
  return Array.from({ length: total }, (_, index) =>
    new Date(base - (total - 1 - index) * 86_400_000).toISOString().slice(0, 10),
  );
}

/** Minutos desde `value`, para a idade do último sinal de um worker. */
export const minutesSince = (value: Date) =>
  Math.max(0, Math.floor((Date.now() - value.getTime()) / 60_000));

export function formatAge(minutes: number) {
  if (minutes < 1) return "agora há pouco";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "há 1 dia" : `há ${days} dias`;
}
