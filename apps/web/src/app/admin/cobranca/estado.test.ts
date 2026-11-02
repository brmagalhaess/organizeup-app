import { describe, expect, it } from "vitest";
import {
  enableRefusal,
  keyNotice,
  stripeActions,
  stripeExitActions,
  webhookConfigured,
} from "./estado";

const TEST = { STRIPE_SECRET_KEY: "sk_test_abc" };
const LIVE = { STRIPE_SECRET_KEY: "sk_live_abc" };

describe("chave da Stripe no painel", () => {
  it("nunca devolve o valor da chave", () => {
    for (const env of [TEST, LIVE, { ...LIVE, STRIPE_ALLOW_LIVE: "true" }]) {
      expect(JSON.stringify(keyNotice(env))).not.toContain("abc");
      expect(JSON.stringify(stripeActions(true, env))).not.toContain("abc");
    }
  });

  it("chave de teste diz que ninguém é cobrado", () => {
    expect(keyNotice(TEST)).toMatchObject({ mode: "teste", real: false });
  });

  it("sk_live_ e rk_live_ dizem com todas as letras que a cobrança é real", () => {
    const allowed = keyNotice({ ...LIVE, STRIPE_ALLOW_LIVE: "true" });
    expect(allowed).toMatchObject({ mode: "producao", real: true, tone: "danger" });
    expect(allowed.text).toContain("cobrança real");
    const restricted = keyNotice({ STRIPE_SECRET_KEY: "rk_live_abc", STRIPE_ALLOW_LIVE: "true" });
    expect(restricted.text).toContain("cobrança real");
  });

  it("chave de produção sem a variável do fundador fica recusada", () => {
    expect(keyNotice(LIVE).label).toBe("Produção recusada");
    expect(stripeActions(true, LIVE).available).toBe(false);
  });

  it("sem chave ou com chave estranha, diz o que falta", () => {
    expect(keyNotice({}).mode).toBe("ausente");
    expect(keyNotice({ STRIPE_SECRET_KEY: "qualquer" }).mode).toBe("invalida");
  });
});

describe("ações da Stripe", () => {
  it("cobrança desligada: reenviar e desconto ficam fora, com explicação", () => {
    const state = stripeActions(false, TEST);
    expect(state.available).toBe(false);
    expect(state.reason).toContain("desligada");
  });

  it("cancelar e devolver não dependem da chave da cobrança, só de uma chave da Stripe", () => {
    expect(stripeExitActions(TEST).available).toBe(true);
    expect(stripeExitActions({}).reason).toContain("STRIPE_SECRET_KEY");
  });

  it("cobrança ligada e chave boa: disponíveis", () => {
    expect(stripeActions(true, TEST)).toEqual({ available: true, reason: null });
  });

  it("cobrança ligada sem chave: indisponíveis, dizendo o que falta", () => {
    expect(stripeActions(true, {}).reason).toContain("STRIPE_SECRET_KEY");
  });
});

describe("ligar a cobrança", () => {
  const WEBHOOK = { STRIPE_WEBHOOK_SECRET: "whsec_a" };

  it("sem webhook é recusado: quem pagasse não receberia o plano", () => {
    expect(enableRefusal(TEST)).toContain("STRIPE_WEBHOOK_SECRET");
  });

  it("sem chave utilizável é recusado", () => {
    expect(enableRefusal(WEBHOOK)).toContain("STRIPE_SECRET_KEY");
    expect(enableRefusal({ ...LIVE, ...WEBHOOK })).toContain("STRIPE_ALLOW_LIVE");
  });

  it("com as duas, pode", () => {
    expect(enableRefusal({ ...TEST, ...WEBHOOK })).toBeNull();
  });
});

describe("webhook", () => {
  it("só diz se o segredo existe", () => {
    expect(webhookConfigured({ STRIPE_WEBHOOK_SECRET: "whsec_a" })).toBe(true);
    expect(webhookConfigured({ STRIPE_WEBHOOK_SECRET: " " })).toBe(false);
    expect(webhookConfigured({})).toBe(false);
  });
});
