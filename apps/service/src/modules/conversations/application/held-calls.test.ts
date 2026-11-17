import { describe, expect, it } from "vitest";
import { approvalQuestion } from "../domain/consult.js";
import { CALL, request, heldCallsWith, anApproval } from "./held-calls.fixtures.js";

describe("a call behind Change Roles", () => {
  it("runs when the switch is Allowed", async () => {
    const { heldCalls, opened } = heldCallsWith({ changeRoles: { kind: "allowed" } });

    await expect(heldCalls.hold(request)).resolves.toEqual({ kind: "proceed", roleKey: "planner" });
    expect(opened).toEqual([]);
  });

  it("is refused at once, with the reason, when the switch is Never", async () => {
    const { heldCalls, opened } = heldCallsWith({ changeRoles: { kind: "never" } });

    const outcome = await heldCalls.hold(request);

    expect(outcome).toMatchObject({ kind: "refused" });
    expect(outcome).toHaveProperty("reason", expect.stringContaining("Change Roles is Never"));
    expect(opened).toEqual([]);
  });

  it("waits on the user for an approval when the switch is Ask me", async () => {
    const { heldCalls, opened } = heldCallsWith({ changeRoles: { kind: "ask-me" } });

    await expect(heldCalls.hold(request)).resolves.toEqual({ kind: "held", waitingOn: "the user" });
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({
      kind: "approval",
      questions: [
        { kind: "choice", question: approvalQuestion(CALL), options: ["Allow once", "Deny"] },
      ],
    });
  });

  it('runs once after "Allow once", and waits again for the next call', async () => {
    const { heldCalls, opened } = heldCallsWith({
      changeRoles: { kind: "ask-me" },
      answered: [anApproval(0)],
    });

    await expect(heldCalls.hold(request)).resolves.toEqual({ kind: "proceed", roleKey: "planner" });
    await expect(heldCalls.hold(request)).resolves.toMatchObject({ kind: "held" });
    expect(opened).toHaveLength(1);
  });

  it("does not take an approval of another call as its own", async () => {
    const other = anApproval(0, "Change the Reviewer's instructions.");
    const { heldCalls } = heldCallsWith({ changeRoles: { kind: "ask-me" }, answered: [other] });

    await expect(heldCalls.hold(request)).resolves.toMatchObject({ kind: "held" });
  });
});
