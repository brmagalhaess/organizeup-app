// Transferência entre contas da própria casa que chegou pelo banco como duas linhas: a saída numa conta e a
// entrada na outra. Somadas como despesa e receita, inflam os dois lados do mês. Aqui só se decide quais
// linhas são as duas pontas da mesma transferência. Sem banco.
import { addDays } from "./income-plan";
import { money } from "./money";
import { normalizeDescription } from "./statement";

export interface TransferLine {
  id: string;
  accountId: string;
  kind: "receita" | "despesa";
  amount: string;
  date: string;
  description: string;
}

export interface TransferBook {
  /** Conta → pessoa dona dela. Conta sem dono fica de fora. */
  accountOwner: Record<string, string>;
  people: Array<{ id: string; name: string }>;
}

export interface TransferPair {
  /** A saída. */
  fromId: string;
  /** A entrada. */
  toId: string;
}

/** Quantos dias a entrada pode cair antes ou depois da saída: o Pix é na hora, o TED pode virar o dia. */
export const TRANSFER_DAYS = 1;

const PARTICLES = new Set(["da", "de", "do", "das", "dos", "e"]);
/** Frases que o banco usa quando o dinheiro vai para outra conta da mesma pessoa. */
const OWN_ACCOUNT_WORDS =
  /\bconta (digital|investimento|corrente|poupanca|de pagamento)\b|mesma titularidade|entre contas|propria conta/;

/**
 * O extrato cita a pessoa? Pede o primeiro nome e mais um nome dela, como palavras inteiras: o banco escreve
 * o nome completo ("Ana Souza Lima") e o cadastro, o curto ("Ana Lima"). Nome de uma
 * palavra só precisa ter quatro letras ou mais.
 */
export function namesPerson(description: string, name: string): boolean {
  const words = new Set(normalizeDescription(description).split(" "));
  const [first, ...rest] = normalizeDescription(name)
    .split(" ")
    .filter((word) => word && !PARTICLES.has(word));
  if (!first || !words.has(first)) return false;
  return rest.length === 0 ? first.length >= 4 : rest.some((word) => words.has(word));
}

/**
 * As linhas que são duas pontas da mesma transferência: mesmo valor, contas diferentes, até um dia de
 * distância, e o extrato confirma. Entre pessoas, os dois lados precisam citar a dona da outra conta: a
 * saída diz para quem foi e a entrada diz de quem veio. Na mesma pessoa, basta um lado citar o próprio nome
 * ou a frase do banco para conta própria. Sem essa confirmação nada casa: um Pix para fora e outro, de
 * mesmo valor, vindo de fora no mesmo dia não são uma transferência. Cada linha entra em um par só.
 */
export function pairOwnTransfers(lines: TransferLine[], book: TransferBook): TransferPair[] {
  const nameOf = new Map(book.people.map((person) => [person.id, person.name]));
  const ownerName = (accountId: string) => {
    const owner = book.accountOwner[accountId];
    return owner ? nameOf.get(owner) : undefined;
  };
  const confirmed = (out: TransferLine, into: TransferLine) => {
    const from = ownerName(out.accountId);
    const to = ownerName(into.accountId);
    if (!from || !to) return false;
    if (book.accountOwner[out.accountId] === book.accountOwner[into.accountId]) {
      return (
        namesPerson(out.description, to) ||
        namesPerson(into.description, from) ||
        OWN_ACCOUNT_WORDS.test(normalizeDescription(out.description)) ||
        OWN_ACCOUNT_WORDS.test(normalizeDescription(into.description))
      );
    }
    return namesPerson(out.description, to) && namesPerson(into.description, from);
  };

  // Ordenação estável: no mesmo dia vale a ordem em que as linhas chegaram.
  const byDate = (a: TransferLine, b: TransferLine) => a.date.localeCompare(b.date);
  const entries = lines.filter((line) => line.kind === "receita").sort(byDate);
  const used = new Set<string>();
  const pairs: TransferPair[] = [];
  for (const out of lines.filter((line) => line.kind === "despesa").sort(byDate)) {
    const first = addDays(out.date, -TRANSFER_DAYS);
    const last = addDays(out.date, TRANSFER_DAYS);
    const match = entries
      .filter(
        (into) =>
          !used.has(into.id) &&
          into.accountId !== out.accountId &&
          into.date >= first &&
          into.date <= last &&
          money(into.amount).eq(out.amount) &&
          confirmed(out, into),
      )
      // O mesmo dia vem antes do dia vizinho.
      .sort((a, b) => Number(a.date !== out.date) - Number(b.date !== out.date))[0];
    if (!match) continue;
    used.add(match.id);
    pairs.push({ fromId: out.id, toId: match.id });
  }
  return pairs;
}
