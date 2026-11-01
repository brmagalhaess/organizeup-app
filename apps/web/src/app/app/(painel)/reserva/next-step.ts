// O que a família deve fazer agora na reserva. Puro: recebe o estado e devolve a chave do texto e o destino.
import { money, toDbAmount, type ReserveStatus } from "@organizeup/domain";

export interface NextStepInput {
  /** Já existe base para calcular o alvo? */
  hasBaseline: boolean;
  hasExpenses: boolean;
  accounts: Array<{ name: string; selected: boolean }>;
  status: ReserveStatus;
  /** Quanto guardar por mês: o salvo, o digitado ou o sugerido. */
  contribution: string | null;
}

export type NextStepKey =
  | "markEssential"
  | "logExpenses"
  | "complete"
  | "completeExtra"
  | "createAccount"
  | "chooseAccount"
  | "setAmount"
  | "saveOne"
  | "saveMany";

export interface NextStep {
  /** Bloco de `reserva.nextStep` nas mensagens: título, texto e rótulo da ação. */
  key: NextStepKey;
  /** Valor citado no texto, em formato de banco. */
  amount?: string;
  /** Nome da conta citada no texto. */
  place?: string;
  action: {
    href: string;
    /** Leva a uma ação de escrita: quem só lê não vê o botão. */
    writes: boolean;
  };
}

export function reserveNextStep(input: NextStepInput): NextStep {
  const { hasBaseline, hasExpenses, accounts, status, contribution } = input;

  if (!hasBaseline) {
    return hasExpenses
      ? { key: "markEssential", action: { href: "/app/categorias", writes: true } }
      : { key: "logExpenses", action: { href: "/app/lancamentos", writes: true } };
  }

  const selected = accounts.filter((account) => account.selected);
  const missing = money(status.missing);

  if (missing.isZero()) {
    const extra = money(status.saved).minus(status.target);
    const action = { href: "/app/metas", writes: false };
    return extra.gt(0)
      ? { key: "completeExtra", amount: toDbAmount(extra), action }
      : { key: "complete", action };
  }

  if (accounts.length === 0)
    return { key: "createAccount", action: { href: "/app/contas", writes: true } };

  if (selected.length === 0)
    return { key: "chooseAccount", action: { href: "#quanto-tenho", writes: true } };

  const each = contribution === null ? null : money(contribution);
  if (each === null || each.lte(0))
    return { key: "setAmount", action: { href: "#quanto-falta", writes: true } };

  const amount = toDbAmount(each.lt(missing) ? each : missing);
  const action = { href: "/app/contas", writes: true };
  return selected.length === 1
    ? { key: "saveOne", amount, place: selected[0]!.name, action }
    : { key: "saveMany", amount, action };
}
