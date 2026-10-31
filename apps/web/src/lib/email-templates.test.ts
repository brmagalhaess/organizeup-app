import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appUrl,
  escapeHtml,
  invitationEmail,
  passwordChangedEmail,
  resetPasswordEmail,
  verifyEmail,
} from "./email-templates";

const hostile = `<script>alert("x")</script> & 'cia'`;

describe("modelos de e-mail", () => {
  beforeEach(() => {
    vi.stubEnv("BETTER_AUTH_URL", "https://app.example.com/");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("escapa o que pode virar HTML", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });

  it("monta links a partir de BETTER_AUTH_URL, sem barra dobrada", () => {
    expect(appUrl("/convite/1")).toBe("https://app.example.com/convite/1");
  });

  it("redefinir senha leva ao retorno que confere o token e abre a tela", () => {
    const email = resetPasswordEmail({ name: "Ana", token: "abc 123" });
    const link =
      "https://app.example.com/api/auth/reset-password/abc%20123?callbackURL=%2Fredefinir-senha";
    expect(email.template).toBe("redefinir-senha");
    expect(email.text).toContain(link);
    expect(email.html).toContain(`href="${link}"`);
    expect(email.text).toContain("Olá, Ana!");
    expect(email.text).toContain("vale 1 hora");
  });

  it("confirmar e-mail escapa o & do link no HTML e não no texto", () => {
    const email = verifyEmail({ name: "Ana", token: "t.o-k" });
    const link =
      "https://app.example.com/api/auth/verify-email?token=t.o-k&callbackURL=%2Fapp%2Fescolher";
    expect(email.template).toBe("confirmar-email");
    expect(email.text).toContain(link);
    expect(email.html).toContain(`href="${escapeHtml(link)}"`);
  });

  it("aviso de senha alterada aponta para pedir nova senha", () => {
    const email = passwordChangedEmail({ name: "Ana" });
    expect(email.template).toBe("senha-alterada");
    expect(email.text).toContain("https://app.example.com/esqueci-senha");
  });

  it("convite usa o link existente e deixa nomes fora do assunto", () => {
    const email = invitationEmail({
      id: "0f8fad5b-d9cb-469f-a165-70867728950e",
      familyName: "Família Silva",
      inviterName: "Ana",
    });
    expect(email.template).toBe("convite");
    expect(email.text).toContain(
      "https://app.example.com/convite/0f8fad5b-d9cb-469f-a165-70867728950e",
    );
    expect(email.text).toContain("Ana convidou você");
    expect(email.text).toContain("família Família Silva");
    expect(email.subject).not.toContain("Ana");
    expect(email.subject).not.toContain("Silva");
  });

  it("nome hostil não vira HTML em nenhum modelo", () => {
    const emails = [
      resetPasswordEmail({ name: hostile, token: "t" }),
      verifyEmail({ name: hostile, token: "t" }),
      passwordChangedEmail({ name: hostile }),
      invitationEmail({ id: "1", familyName: hostile, inviterName: hostile }),
    ];
    for (const email of emails) {
      expect(email.html).not.toContain("<script");
      expect(email.html).toContain("&lt;script&gt;");
      expect(email.html).not.toContain("&amp;lt;");
    }
  });

  it("nome corta quebra de linha e tamanho, e nome vazio não deixa saudação torta", () => {
    const long = resetPasswordEmail({ name: `Ana\r\nBeatriz ${"x".repeat(500)}`, token: "t" });
    expect(long.text).toContain("Olá, Ana Beatriz x");
    expect(long.text).not.toContain("x".repeat(100));
    expect(resetPasswordEmail({ name: "  ", token: "t" }).text).toContain("Olá!");
  });

  it("todo modelo tem HTML em pt-BR e versão em texto sem marcação", () => {
    const emails = [
      resetPasswordEmail({ name: "Ana", token: "t" }),
      verifyEmail({ name: "Ana", token: "t" }),
      passwordChangedEmail({ name: "Ana" }),
      invitationEmail({ id: "1", familyName: "Silva", inviterName: "Ana" }),
    ];
    for (const email of emails) {
      expect(email.html).toContain('lang="pt-BR"');
      expect(email.text).not.toContain("<");
      expect(email.subject).toContain("OrganizeUp");
    }
  });
});
