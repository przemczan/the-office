import { describe, expect, it } from "vitest";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { MemoryService, RoleRefused, type HardSwitchValue } from "../../../people/index.js";
import { aPlannerCard } from "../../application/session-role.fixtures.js";
import { aThread } from "../../domain/thread.fixtures.js";
import {
  CHANGE_ROLE_TOOL,
  REMEMBER_TOOL,
  sessionOfficeTools,
} from "../../domain/session-instructions.js";
import type { Thread } from "../../domain/thread.js";
import { ThreadRepository } from "../../ports/thread-repository.js";
import { MemoryOfficeTools } from "./memory-office-tools.js";

type Draft = Parameters<MemoryService["write"]>[0];

const NEVER: HardSwitchValue = { kind: "never" };
const SESSION = "session-1";
const TASK = "task-1";

/** The tool as registered, with a Memory that keeps the drafts it is given or refuses them. */
function toolWith(thread: Thread | undefined, refusal?: string) {
  const written: Draft[] = [];
  const memory = {
    write: (draft: Draft) => {
      if (refusal) throw new RoleRefused([refusal]);
      written.push(draft);
      return Promise.resolve();
    },
  } as unknown as MemoryService;
  const threads = {
    findBySession: (sessionId: string) =>
      Promise.resolve(sessionId === SESSION ? thread : undefined),
  } as unknown as ThreadRepository;
  const registry = new OfficeToolRegistry();
  new MemoryOfficeTools(registry, memory, threads).onModuleInit();
  const [tool] = registry.named([REMEMBER_TOOL]);
  if (!tool) throw new Error("remember is not registered.");
  return { tool, written };
}

describe("the remember tool", () => {
  it("appends a note to the person's Memory with the Thread it came from", async () => {
    const thread = aThread();
    const { tool, written } = toolWith(thread);

    const result = await tool.run(
      { note: "Prefers short answers.", project: " Admin panel " },
      { sessionId: SESSION },
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

  it("names the Task when the Thread is on one, and the Project only when given", async () => {
    const thread = aThread({ home: { kind: "task", taskId: TASK } });
    const { tool, written } = toolWith(thread);

    await tool.run({ note: "Run lint before tests." }, { sessionId: SESSION });

    expect(written[0]).toMatchObject({
      projectId: undefined,
      source: { kind: "agent", threadId: thread.id, taskId: TASK },
    });
  });

  it("writes nothing and says why when the Memory refuses the note", async () => {
    const { tool, written } = toolWith(aThread(), "Jan's shared memory is off.");

    await expect(tool.run({ note: "Anything." }, { sessionId: SESSION })).resolves.toEqual({
      text: "Jan's shared memory is off.",
      isError: true,
    });
    expect(written).toEqual([]);
  });

  it("is refused to a session no Thread has", async () => {
    const { tool, written } = toolWith(undefined);

    await expect(tool.run({ note: "Anything." }, { sessionId: "other" })).resolves.toEqual({
      text: "The Office doesn't know this session's Thread.",
      isError: true,
    });
    expect(written).toEqual([]);
  });
});

const card = (sharedMemory: boolean, changeRoles: HardSwitchValue) =>
  aPlannerCard({
    capabilities: { sharedMemory, chat: true, consultant: true },
    hardSwitches: { ...aPlannerCard().hardSwitches, changeRoles },
  });

describe("the Office tools of a session", () => {
  it("offer remember only while the card's Shared memory is on", () => {
    expect(sessionOfficeTools(["read_task"], card(true, NEVER), true)).toEqual([
      "read_task",
      REMEMBER_TOOL,
    ]);
    expect(sessionOfficeTools(["read_task"], card(false, NEVER), true)).toEqual(["read_task"]);
  });

  it.each([{ kind: "allowed" }, { kind: "ask-me" }, { kind: "consult", role: "cto" }] as const)(
    "offer change_role on a Task when Change Roles is %o",
    (changeRoles) => {
      expect(sessionOfficeTools(["read_task"], card(false, changeRoles), true)).toEqual([
        "read_task",
        CHANGE_ROLE_TOOL,
      ]);
    },
  );

  it("keep change_role from a chat, which has no Task Thread to hold a call in", () => {
    expect(sessionOfficeTools(["read_task"], card(false, { kind: "ask-me" }), false)).toEqual([
      "read_task",
    ]);
  });
});
