import { describe, expect, it } from "vitest";
import { heldCallRuling } from "./held-call.js";

const titleOf = (roleKey: string): string => (roleKey === "cto" ? "CTO" : roleKey);

describe("heldCallRuling", () => {
  it("lets an Allowed call run", () => {
    expect(heldCallRuling("Change Roles", { kind: "allowed" }, titleOf)).toEqual({
      kind: "proceed",
    });
  });

  it("refuses a Never call with the reason the Agent reads", () => {
    expect(heldCallRuling("Change Roles", { kind: "never" }, titleOf)).toEqual({
      kind: "refuse",
      reason:
        "Not allowed for you: Change Roles is Never on your Role card. Open a Decision if you need it.",
    });
  });

  it("asks the user for Ask me", () => {
    expect(heldCallRuling("Change Roles", { kind: "ask-me" }, titleOf)).toEqual({
      kind: "ask",
      person: undefined,
    });
  });

  it("asks the person to consult, by their Role's title", () => {
    expect(heldCallRuling("Change Roles", { kind: "consult", role: "cto" }, titleOf)).toEqual({
      kind: "ask",
      person: "CTO",
    });
  });
});
