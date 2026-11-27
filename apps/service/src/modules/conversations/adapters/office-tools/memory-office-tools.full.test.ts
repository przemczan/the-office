import { describe, expect, it } from "vitest";
import { aThread } from "../../domain/thread.fixtures.js";
import { REMEMBER_TOOL, sessionOfficeTools } from "../../domain/session-instructions.js";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";
import { SESSION, toolWith, card } from "./memory-office-tools.fixtures.js";

const TASK = "task-1";

describe("the remember tool", () => {
  it("names the Task when the Thread is on one, and the Project only when given", async () => {
    const thread = aThread({ home: { kind: "task", taskId: TASK } });
    const { tool, written } = toolWith(thread);

    await tool.run({ note: "Run lint before tests." }, anOfficeToolCall(SESSION));

    expect(written[0]).toMatchObject({
      projectId: undefined,
      source: { kind: "agent", threadId: thread.id, taskId: TASK },
    });
  });

  it("writes nothing and says why when the Memory refuses the note", async () => {
    const { tool, written } = toolWith(aThread(), "Jan's shared memory is off.");

    await expect(tool.run({ note: "Anything." }, anOfficeToolCall(SESSION))).resolves.toEqual({
      text: "Jan's shared memory is off.",
      isError: true,
    });
    expect(written).toEqual([]);
  });

  it("is refused to a session no Thread has", async () => {
    const { tool, written } = toolWith(undefined);

    await expect(tool.run({ note: "Anything." }, anOfficeToolCall("other"))).resolves.toEqual({
      text: "The Office doesn't know this session's Thread.",
      isError: true,
    });
    expect(written).toEqual([]);
  });
});

describe("the Office tools of a session", () => {
  it("offer remember only while the card's Shared memory is on", () => {
    expect(sessionOfficeTools(["read_task"], card(true))).toEqual(["read_task", REMEMBER_TOOL]);
    expect(sessionOfficeTools(["read_task"], card(false))).toEqual(["read_task"]);
  });
});
