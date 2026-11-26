import { describe, expect, it } from "vitest";
import { type HardSwitchValue } from "../../../people/index.js";
import { aThread } from "../../domain/thread.fixtures.js";
import {
  CHANGE_ROLE_TOOL,
  READ_ROLE_TOOL,
  REMEMBER_TOOL,
  sessionOfficeTools,
} from "../../domain/session-instructions.js";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";
import { SESSION, toolWith, card } from "./memory-office-tools.fixtures.js";

const NEVER: HardSwitchValue = { kind: "never" };
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
    expect(sessionOfficeTools(["read_task"], card(true, NEVER), true)).toEqual([
      "read_task",
      REMEMBER_TOOL,
    ]);
    expect(sessionOfficeTools(["read_task"], card(false, NEVER), true)).toEqual(["read_task"]);
  });

  it("offer change_role on a Task when Change Roles is Ask me, with read_role to start from", () => {
    expect(sessionOfficeTools(["read_task"], card(false, { kind: "ask-me" }), true)).toEqual([
      "read_task",
      CHANGE_ROLE_TOOL,
      READ_ROLE_TOOL,
    ]);
  });

  it.each([{ kind: "proposal" }, { kind: "never" }] as const)(
    "keep change_role when Change Roles is %o, which the view reads as Never",
    (changeRoles) => {
      expect(sessionOfficeTools(["read_task"], card(false, changeRoles), true)).toEqual([
        "read_task",
      ]);
    },
  );

  it("offer read_role once when the place already has it", () => {
    expect(sessionOfficeTools([READ_ROLE_TOOL], card(false, { kind: "ask-me" }), true)).toEqual([
      READ_ROLE_TOOL,
      CHANGE_ROLE_TOOL,
    ]);
  });
});
