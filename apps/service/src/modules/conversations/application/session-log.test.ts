import { describe, expect, it } from "vitest";
import { sessionLogLines, type SessionLogger } from "./session-log.js";

const logger: SessionLogger = {
  roleKey: "developer",
  folder: "/worktrees/shop/task-1",
  handingOver: false,
  mask: { mask: (text) => text.replaceAll("npm_s3cret", "[secret NPM_TOKEN]") },
};

describe("sessionLogLines", () => {
  it("hides a Secret variable in the person's words and their Handover note", () => {
    const event = {
      kind: "text",
      text: "The token is npm_s3cret.",
      withinToolCall: undefined,
    } as const;

    expect(sessionLogLines(event, logger)).toEqual([
      { kind: "person", roleKey: "developer", text: "The token is [secret NPM_TOKEN]." },
    ]);
    expect(sessionLogLines(event, { ...logger, handingOver: true })).toEqual([
      { kind: "handover-note", roleKey: "developer", text: "The token is [secret NPM_TOKEN]." },
    ]);
  });

  it("hides it in a tool call's command line and in a refusal", () => {
    expect(
      sessionLogLines(
        {
          kind: "tool-call",
          callId: "call-1",
          tool: "Bash",
          officeTool: false,
          input: { command: "curl -H 'Authorization: npm_s3cret' https://registry" },
          withinToolCall: undefined,
        },
        logger,
      ),
    ).toEqual([
      {
        kind: "tool-activity",
        roleKey: "developer",
        tool: "Bash",
        summary: "curl -H 'Authorization: [secret NPM_TOKEN]' https://registry",
      },
    ]);
    expect(
      sessionLogLines(
        {
          kind: "tool-refused",
          callId: "call-2",
          tool: "Bash",
          reason: "Refused: echo npm_s3cret",
          refusedBy: "office-rules",
        },
        logger,
      ),
    ).toEqual([
      {
        kind: "refusal",
        roleKey: "developer",
        tool: "Bash",
        reason: "Refused: echo [secret NPM_TOKEN]",
      },
    ]);
  });
});
