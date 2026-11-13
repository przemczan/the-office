import { describe, expect, it } from "vitest";
import type { ToolCallEvent } from "../../ports/session-events.js";
import { callAsRun, foregroundSubAgentInput } from "./foreground-sub-agents.js";

describe("foregroundSubAgentInput", () => {
  it.each(["Agent", "Task"])(
    "runs a %s call in the foreground, keeping every other field",
    (tool) => {
      const input = {
        description: "Review the diff",
        prompt: "Review it",
        subagent_type: "general-purpose",
        run_in_background: true,
      };

      expect(foregroundSubAgentInput(tool, input)).toEqual({
        description: "Review the diff",
        prompt: "Review it",
        subagent_type: "general-purpose",
        run_in_background: false,
      });
    },
  );

  it("sets the foreground on a call that named no background at all", () => {
    expect(foregroundSubAgentInput("Agent", { prompt: "Look" })).toEqual({
      prompt: "Look",
      run_in_background: false,
    });
  });

  it("leaves any other tool's call alone", () => {
    expect(
      foregroundSubAgentInput("Bash", { command: "npm run dev", run_in_background: true }),
    ).toBeUndefined();
  });
});

describe("callAsRun", () => {
  const call: ToolCallEvent = {
    kind: "tool-call",
    callId: "c1",
    tool: "Agent",
    officeTool: false,
    input: { prompt: "Review it", run_in_background: true },
    withinToolCall: undefined,
  };

  it("shows a Sub-agent call as the foreground one it ran as in a session that asks it", () => {
    expect(callAsRun(call, { subAgentsInForeground: true })).toEqual({
      ...call,
      input: { prompt: "Review it", run_in_background: false },
    });
  });

  it("shows it as the Agent wrote it in any other session", () => {
    expect(callAsRun(call, {})).toBe(call);
  });
});
