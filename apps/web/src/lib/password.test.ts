import { describe, expect, it } from "vitest";
import { isValidPassword } from "./password";

describe("regra de senha", () => {
  it.each(["abc123!", "a1!", "Coração9#", "senha-segura-123!"])("aceita %s", (password) => {
    expect(isValidPassword(password)).toBe(true);
  });

  it.each(["", "abcdefgh", "12345678", "abc12345", "abc!!!!!", "123!!!!!", "abc 123"])(
    "recusa %j",
    (password) => {
      expect(isValidPassword(password)).toBe(false);
    },
  );
});
