import { describe, expect, it } from "vitest";
import { aThread } from "../../domain/thread.fixtures.js";
import { PROJECT_SETTING_TOOLS, sessionOfficeTools } from "../../domain/session-instructions.js";
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
    expect(
      sessionOfficeTools(["read_task"], card(false, { kind: "ask-me" }), false, false),
    ).toEqual(["read_task"]);
  });

  it("offer the Project setting tools in an Agent Stage or a Consultation on a Task, not at Never", () => {
    const allowed = card(false, { kind: "never" }, { kind: "allowed" });

    expect(sessionOfficeTools(["read_task"], allowed, true, true)).toEqual([
      "read_task",
      ...PROJECT_SETTING_TOOLS,
    ]);
    expect(
      sessionOfficeTools(
        ["read_task"],
        card(false, { kind: "never" }, { kind: "never" }),
        true,
        true,
      ),
    ).toEqual(["read_task"]);
  });

  it("keep the Project setting tools from a chat, a Planning Thread and a person's Thread on a Task", () => {
    const allowed = card(false, { kind: "never" }, { kind: "allowed" });

    // A chat and a person's Thread on a Task can't hold a call; a Planning Thread can, but changes no setting.
    expect(sessionOfficeTools(["read_task"], allowed, false, false)).toEqual(["read_task"]);
    expect(sessionOfficeTools(["read_task"], allowed, true, false)).toEqual(["read_task"]);
  });
});
