import { describe, expect, it } from "vitest";
import { aThread } from "../../domain/thread.fixtures.js";
import { sessionOfficeTools } from "../../domain/session-instructions.js";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";
import { SESSION, toolWith, card } from "./memory-office-tools.fixtures.js";

describe("the remember tool", () => {
  it("appends a note to the person's Memory with the Thread it came from", async () => {
    const thread = aThread();
    const { tool, written } = toolWith(thread);

    const result = await tool.run(
      { note: "Prefers short answers.", project: " Admin panel " },
      anOfficeToolCall(SESSION),
    );

    expect(result.isError).toBe(false);
    expect(written).toEqual([
      {
        roleKey: thread.roleKey,
        projectId: "Admin panel",
        text: "Prefers short answers.",
        source: { kind: "agent", threadId: thread.id, taskId: undefined },
      },
    ]);
  });
});

describe("the Office tools of a session", () => {
  it("keep change_role from a chat, which has no Task Thread to hold a call in", () => {
    expect(sessionOfficeTools(["read_task"], card(false, { kind: "ask-me" }), false)).toEqual([
      "read_task",
    ]);
  });
});
