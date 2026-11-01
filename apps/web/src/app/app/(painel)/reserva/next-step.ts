// O que a família deve fazer agora na reserva. Puro: recebe o estado e devolve texto e destino.
import { formatBRL, money, type ReserveStatus } from "@organizeup/domain";

export interface NextStepInput {
  /** Já existe base para calcular o alvo? */
  hasBaseline: boolean;
  hasExpenses: boolean;
  accounts: Array<{ name: string; selected: boolean }>;
  status: ReserveStatus;
  /** Quanto guardar por mês: o salvo, o digitado ou o sugerido. */
  contribution: string | null;
}

export interface NextStep {
  title: string;
  text: string;
  action: {
    label: string;
    href: string;
    /** Leva a uma ação de escrita: quem só lê não vê o botão. */
    writes: boolean;
  };
}

export function reserveNextStep(input: NextStepInput): NextStep {
  const { hasBaseline, hasExpenses, accounts, status, contribution } = input;

  if (!hasBaseline) {
    return hasExpenses
      ? {
          title: "Marque o que é essencial",
          text: "Você já tem gastos lançados, mas nenhum em categoria essencial. Marque como essenciais moradia, mercado, contas e o que mais não dá para cortar.",
          action: { label: "Abrir categorias", href: "/app/categorias", writes: true },
        }
      : {
          title: "Lance seus gastos do mês",
          text: "Para calcular sua reserva, precisamos saber quanto custam moradia, mercado e contas. Lance esses gastos, ou informe o valor total acima.",
          action: { label: "Ir para lançamentos", href: "/app/lancamentos", writes: true },
        };
  }

  const selected = accounts.filter((account) => account.selected);
  const missing = money(status.missing);

  if (missing.isZero()) {
    const extra = money(status.saved).minus(status.target);
    return {
      title: "Sua reserva está completa",
      text: extra.gt(0)
        ? `Você tem ${formatBRL(extra)} além do necessário. Esse excedente pode ir para suas metas. Deixe o resto guardado e reponha sempre que usar.`
        : "Deixe esse dinheiro guardado e reponha sempre que usar. O que você guardar daqui em diante pode ir para suas metas.",
      action: { label: "Ver minhas metas", href: "/app/metas", writes: false },
    };
  }

  if (accounts.length === 0)
    return {
      title: "Crie a conta da reserva",
      text: "A reserva fica em uma conta sua. Crie uma conta para guardar esse dinheiro e depois marque ela aqui.",
      action: { label: "Criar conta", href: "/app/contas", writes: true },
    };

  if (selected.length === 0)
    return {
      title: "Escolha onde fica a reserva",
      text: "Marque a conta onde você guarda esse dinheiro. Se ainda não tem uma separada, vale criar uma só para isso.",
      action: { label: "Escolher conta", href: "#quanto-tenho", writes: true },
    };

  const each = contribution === null ? null : money(contribution);
  if (each === null || each.lte(0))
    return {
      title: "Defina quanto guardar por mês",
      text: "Escolha um valor que caiba no seu mês, mesmo pequeno. Assim mostramos quando a reserva fica pronta.",
      action: { label: "Definir valor", href: "#quanto-falta", writes: true },
    };

  const amount = each.lt(missing) ? each : missing;
  const place = selected.length === 1 ? selected[0]!.name : "uma das contas da reserva";
  return {
    title: `Guarde ${formatBRL(amount)} este mês`,
    text: `Coloque esse valor em ${place}. Repita todo mês até completar a reserva.`,
    action: { label: "Ir para contas", href: "/app/contas", writes: true },
  };
}
