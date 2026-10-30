import { describe, expect, it } from "vitest";
import { inviteId } from "./invites";

describe("inviteId", () => {
  it("aceita UUID", () => {
    const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
    expect(inviteId(id)).toBe(id);
  });

  it("recusa o que poderia desviar o redirecionamento", () => {
    expect(inviteId("//example.com")).toBeNull();
    expect(inviteId("../app")).toBeNull();
    expect(inviteId("")).toBeNull();
    expect(inviteId(undefined)).toBeNull();
    expect(inviteId(["0f8fad5b-d9cb-469f-a165-70867728950e"])).toBeNull();
  });
});
