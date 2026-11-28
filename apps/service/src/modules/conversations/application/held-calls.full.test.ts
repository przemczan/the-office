import { describe, expect, it } from "vitest";
import { ApprovalHolds } from "./approval-holds.js";
import { SESSION, request, heldCallsWith, anApproval, call } from "./held-calls.fixtures.js";

describe("a call behind Change Project settings", () => {
  it("waits on the Consultant in a Consultation when the switch is Consult", async () => {
    const { heldCalls, opened, putTo } = heldCallsWith({
      setting: { kind: "consult", role: "cto" },
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
      setting: { kind: "consult", role: "cto" },
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
    const { heldCalls, opened } = heldCallsWith({ setting: { kind: "consult", role: "cto" } });

    await expect(heldCalls.hold(request)).resolves.toEqual({ kind: "held", waitingOn: "the user" });
    expect(opened[0]?.context).not.toContain("For CTO:");
  });

  it('waits again after "Deny"', async () => {
    const { heldCalls, opened } = heldCallsWith({
      setting: { kind: "ask-me" },
      answered: [anApproval(1)],
    });

    await expect(heldCalls.hold(request)).resolves.toMatchObject({ kind: "held" });
    expect(opened).toHaveLength(1);
  });

  it("is refused with the reason when the Thread can't hold a Decision", async () => {
    const { heldCalls } = heldCallsWith({
      setting: { kind: "ask-me" },
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
    const { heldCalls, opened } = heldCallsWith({ setting: { kind: "never" } });

    const words = await heldCalls.holdMcpToolCall(SESSION, call({ title: "Bug", body: "x" }));

    expect(words).toContain("waits on the user");
    expect(words).toContain("End your turn now");
    expect(opened[0]?.questions[0]).toMatchObject({
      question: "Allow Jan to create_issue (MCP server github)?",
      heldCall: {
        key: 'Call the github/create_issue MCP tool with {"body":"x","title":"Bug"}',
        action: "create_issue (MCP server github)",
        input: { title: "Bug", body: "x" },
        callAsSent: { server: "github", tool: "create_issue", input: { title: "Bug", body: "x" } },
      },
    });
  });

  it("asks the Consultant its setting names, in their Consultation", async () => {
    const { heldCalls, putTo } = heldCallsWith({
      setting: { kind: "never" },
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
    const approval = anApproval(
      0,
      'Call the github/create_issue MCP tool with {"body":"x","title":"Bug"}',
    );
    const { heldCalls } = heldCallsWith({ setting: { kind: "never" }, answered: [approval] });

    await expect(
      heldCalls.holdMcpToolCall(SESSION, call({ title: "Bug", body: "x" })),
    ).resolves.toBeUndefined();
    await expect(
      heldCalls.holdMcpToolCall(SESSION, call({ body: "x", title: "Bug" })),
    ).resolves.toContain("waits on the user");
  });

  it("is refused where no Decision opens, in the refusal's words", async () => {
    const { heldCalls } = heldCallsWith({
      setting: { kind: "never" },
      openRefusal: "A Consultation opens no Decision of its own: answer in words.",
    });

    await expect(heldCalls.holdMcpToolCall(SESSION, call({}))).resolves.toBe(
      "A Consultation opens no Decision of its own: answer in words.",
    );
  });

  it("is what the sessions' approval hold asks once the module has started", async () => {
    const approvalHolds = new ApprovalHolds();
    const { heldCalls } = heldCallsWith({ setting: { kind: "never" }, approvalHolds });

    await expect(approvalHolds.of(SESSION, [])(call({}))).resolves.toContain(
      "can't ask for approval yet",
    );
    heldCalls.onModuleInit();
    await expect(approvalHolds.of(SESSION, [])(call({}))).resolves.toContain("waits on the user");
  });

  it("gives the card the tool's description as the session's server listed it", async () => {
    const approvalHolds = new ApprovalHolds();
    const { heldCalls, opened } = heldCallsWith({ setting: { kind: "never" }, approvalHolds });
    heldCalls.onModuleInit();
    const servers = [
      { name: "github", tools: [{ name: "create_issue", description: "Opens an issue." }] },
    ];

    await approvalHolds.of(SESSION, servers)(call({ title: "Bug" }));

    expect(opened[0]?.questions[0]).toMatchObject({
      heldCall: { action: "create_issue (MCP server github)", description: "Opens an issue." },
    });
  });
});
