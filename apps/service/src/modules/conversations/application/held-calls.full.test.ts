import { describe, expect, it } from "vitest";
import { approvalQuestion } from "../domain/consult.js";
import { aDecision } from "../domain/decision.fixtures.js";
import { ApprovalHolds } from "./approval-holds.js";
import { SESSION, request, heldCallsWith, anApproval, call } from "./held-calls.fixtures.js";

describe("a call behind Change Roles", () => {
  it("waits on the Consultant in a Consultation when the switch is Consult", async () => {
    const { heldCalls, opened, putTo } = heldCallsWith({
      changeRoles: { kind: "consult", role: "cto" },
      hired: ["cto"],
      consultants: ["cto"],
    });

    await expect(heldCalls.hold(request)).resolves.toEqual({
      kind: "held",
      waitingOn: "Casey, in a Consultation on this Task",
    });
    expect(putTo).toEqual(["cto"]);
    expect(opened[0]?.context).not.toContain("For CTO:");
  });

  it("waits on the user in place of a hired person who is not a Consultant", async () => {
    const { heldCalls, opened, putTo } = heldCallsWith({
      changeRoles: { kind: "consult", role: "cto" },
      hired: ["cto"],
    });

    await expect(heldCalls.hold(request)).resolves.toEqual({
      kind: "held",
      waitingOn: "the user in place of CTO",
    });
    expect(putTo).toEqual([undefined]);
    expect(opened[0]?.context).toContain("For CTO:");
  });

  it("falls back to the user when nobody fills the Role to consult", async () => {
    const { heldCalls, opened } = heldCallsWith({ changeRoles: { kind: "consult", role: "cto" } });

    await expect(heldCalls.hold(request)).resolves.toEqual({ kind: "held", waitingOn: "the user" });
    expect(opened[0]?.context).not.toContain("For CTO:");
  });

  it('waits again after "Deny"', async () => {
    const { heldCalls, opened } = heldCallsWith({
      changeRoles: { kind: "ask-me" },
      answered: [anApproval(1)],
    });

    await expect(heldCalls.hold(request)).resolves.toMatchObject({ kind: "held" });
    expect(opened).toHaveLength(1);
  });

  it("is refused with the reason when the Thread can't hold a Decision", async () => {
    const { heldCalls } = heldCallsWith({
      changeRoles: { kind: "ask-me" },
      openRefusal: "A chat has no Decisions.",
    });

    await expect(heldCalls.hold(request)).resolves.toEqual({
      kind: "refused",
      reason: "A chat has no Decisions.",
    });
  });
});

describe("a call of an MCP tool waiting on approval", () => {
  it("opens an approval of the call, input and all, and tells the Agent to end its turn", async () => {
    const { heldCalls, opened } = heldCallsWith({ changeRoles: { kind: "never" } });

    const words = await heldCalls.holdMcpToolCall(SESSION, call({ title: "Bug", body: "x" }));

    expect(words).toContain("waits on the user");
    expect(words).toContain("End your turn now");
    expect(opened[0]?.question).toBe(
      approvalQuestion('Call the github/create_issue MCP tool with {"body":"x","title":"Bug"}'),
    );
  });

  it("asks the Consultant its setting names, in their Consultation", async () => {
    const { heldCalls, putTo } = heldCallsWith({
      changeRoles: { kind: "never" },
      hired: ["cto"],
      consultants: ["cto"],
    });

    const words = await heldCalls.holdMcpToolCall(
      SESSION,
      call({}, { kind: "consult", role: "cto" }),
    );

    expect(words).toContain("Casey, in a Consultation on this Task");
    expect(putTo).toEqual(["cto"]);
  });

  it('runs once after "Allow once", whatever order the input\'s keys come in', async () => {
    const approval = aDecision({
      ...anApproval(0),
      question: approvalQuestion(
        'Call the github/create_issue MCP tool with {"body":"x","title":"Bug"}',
      ),
    });
    const { heldCalls } = heldCallsWith({ changeRoles: { kind: "never" }, answered: [approval] });

    await expect(
      heldCalls.holdMcpToolCall(SESSION, call({ title: "Bug", body: "x" })),
    ).resolves.toBeUndefined();
    await expect(
      heldCalls.holdMcpToolCall(SESSION, call({ body: "x", title: "Bug" })),
    ).resolves.toContain("waits on the user");
  });

  it("is refused in a chat in the Hard switch's words", async () => {
    const { heldCalls } = heldCallsWith({
      changeRoles: { kind: "never" },
      openRefusal:
        "A Decision is opened on a Task. In your chat, ask the user in your answer instead.",
    });

    await expect(heldCalls.holdMcpToolCall(SESSION, call({}))).resolves.toBe(
      "A Decision is opened on a Task. In your chat, ask the user in your answer instead.",
    );
  });

  it("is what the sessions' approval hold asks once the module has started", async () => {
    const approvalHolds = new ApprovalHolds();
    const { heldCalls } = heldCallsWith({ changeRoles: { kind: "never" }, approvalHolds });

    await expect(approvalHolds.of(SESSION)(call({}))).resolves.toContain(
      "can't ask for approval yet",
    );
    heldCalls.onModuleInit();
    await expect(approvalHolds.of(SESSION)(call({}))).resolves.toContain("waits on the user");
  });
});
