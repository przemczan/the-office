import { describe, expect, it } from "vitest";
import { z } from "zod";
import { anOfficeToolCall } from "../../engine/index.fixtures.js";
import { OfficeToolRegistry, type OfficeTool, type OfficeToolCall } from "../../engine/index.js";
import type { AuthoritySetting, Duties, DutyKey } from "../../people/index.js";
import { officeToolCallWords } from "../domain/office-tool-ruling.js";
import { aThread } from "../domain/thread.fixtures.js";
import { anApproval, heldCallsWith, SESSION, type Setup } from "./held-calls.fixtures.js";
import { OfficeToolRulings } from "./office-tool-rulings.js";
import { SessionPlaces } from "./session-places.js";
import type { WorkRecords } from "./work-records.js";

const ALLOWED = { kind: "allowed" } as const;
const NEVER = { kind: "never" } as const;
const ASK_ME = { kind: "ask-me" } as const;
const PROPOSAL = { kind: "proposal" } as const;
const CONSULT_CTO = { kind: "consult", role: "cto" } as const;

const TOOL_NAME = "change_task_title";

/** A stand-in for the tool of an Office action of Task records, whose subject is its Task. */
function aTaskTool(ran: unknown[], calls: OfficeToolCall[] = [], name = TOOL_NAME): OfficeTool {
  return {
    name,
    description: "Changes a Task's title.",
    input: z.object({ taskId: z.string(), title: z.string() }),
    authority: {
      group: "taskRecords",
      subject: (input) => ({ kind: "task", id: (input as { taskId: string }).taskId }),
    },
    run: (input, call) => {
      ran.push(input);
      calls.push(call);
      return Promise.resolve({ text: "Done.", isError: false });
    },
  };
}

interface Rulings extends Pick<Setup, "hired" | "consultants" | "answered"> {
  readonly setting: AuthoritySetting;
  /** The Tasks the person created, whose work is their own. */
  readonly ownTasks?: readonly string[];
  readonly duties?: readonly DutyKey[];
  readonly toolName?: string;
}

function rulingsWith({ ownTasks = [], duties = [], toolName = TOOL_NAME, ...setup }: Rulings) {
  const held = heldCallsWith({ ...setup, switchKey: "taskRecords" });
  const work = {
    isOwnWork: (_roleKey: string, { id }: { id: string }) => Promise.resolve(ownTasks.includes(id)),
  } as unknown as WorkRecords;
  const dutyHolder = { heldBy: () => Promise.resolve(duties) } as unknown as Duties;
  const rulings = new OfficeToolRulings(
    held.threads,
    held.roleCards,
    dutyHolder,
    held.heldCalls,
    work,
    held.approvalHolds,
  );
  const ran: unknown[] = [];
  const calls: OfficeToolCall[] = [];
  const registry = new OfficeToolRegistry();
  registry.register(aTaskTool(ran, calls, toolName));
  const [tool] = registry.named([toolName], rulings);
  const callWith = (input: unknown) =>
    (tool as OfficeTool).run(input as never, anOfficeToolCall(SESSION));
  return { ...held, callWith, ran, calls };
}

const input = { taskId: "task-1", title: "New title" };

describe("the ruling of an Office tool call", () => {
  it("runs a call when the Authority says Allowed", async () => {
    const { callWith, ran, opened } = rulingsWith({ setting: ALLOWED });

    await expect(callWith(input)).resolves.toEqual({ text: "Done.", isError: false });
    expect(ran).toEqual([input]);
    expect(opened).toHaveLength(0);
  });

  it("holds an Ask me call for the user's approval, and runs it once after Allow once", async () => {
    const approval = anApproval(0, officeToolCallWords(TOOL_NAME, input));
    const { callWith, ran, opened } = rulingsWith({ setting: ASK_ME, answered: [approval] });

    // The same call with its keys in another order finds the approval, which covers one run.
    await expect(callWith({ title: "New title", taskId: "task-1" })).resolves.toMatchObject({
      isError: false,
    });
    expect(ran).toHaveLength(1);
    expect(opened).toHaveLength(0);

    const third = await callWith(input);
    expect(third.isError).toBe(true);
    expect(third.text).toContain("waits on the user");
    expect(ran).toHaveLength(1);
    expect(opened).toHaveLength(1);
  });

  it("runs an allowed call with the user who allowed it, and an Allowed one with nobody", async () => {
    const ann = { userId: "user-ann", name: "Ann" };
    const approval = anApproval(0, officeToolCallWords(TOOL_NAME, input), { user: ann });
    const held = rulingsWith({ setting: ASK_ME, answered: [approval] });
    const allowed = rulingsWith({ setting: ALLOWED });

    await held.callWith(input);
    await allowed.callWith(input);

    expect(held.calls.map(({ allowedBy }) => allowedBy)).toEqual([ann]);
    expect(allowed.calls.map(({ allowedBy }) => allowedBy)).toEqual([undefined]);
  });

  it("asks again when the input changed after the approval", async () => {
    const approval = anApproval(0, officeToolCallWords(TOOL_NAME, input));
    const { callWith, ran, opened } = rulingsWith({ setting: ASK_ME, answered: [approval] });

    const changed = await callWith({ ...input, title: "Another title" });

    expect(changed.text).toContain("waits on the user");
    expect(ran).toHaveLength(0);
    expect(opened).toHaveLength(1);
  });

  it("holds a first Ask me call with the call's canonical words on the card", async () => {
    const { callWith, opened } = rulingsWith({ setting: ASK_ME });

    await callWith({ title: "New title", taskId: "task-1" });

    expect(opened[0]?.questions[0]?.question).toContain(
      '{"action":"change_task_title","input":{"taskId":"task-1","title":"New title"}}',
    );
  });

  it("holds a Consult call in a Consultation with the person consulted", async () => {
    const { callWith, putTo, ran } = rulingsWith({
      setting: CONSULT_CTO,
      hired: ["cto"],
      consultants: ["cto"],
    });

    const held = await callWith(input);

    expect(held.text).toContain("Casey, in a Consultation on this Task");
    expect(putTo).toEqual(["cto"]);
    expect(ran).toHaveLength(0);
  });

  it("holds a Proposal call as Ask me, with the user", async () => {
    const { callWith, putTo, ran } = rulingsWith({ setting: PROPOSAL });

    const held = await callWith(input);

    expect(held.text).toContain("waits on the user");
    expect(putTo).toEqual([undefined]);
    expect(ran).toHaveLength(0);
  });

  it("refuses a call of a tool ruled Never as no such tool", async () => {
    const { callWith, ran } = rulingsWith({ setting: NEVER });

    await expect(callWith(input)).resolves.toEqual({
      text: `No Office tool is registered as ${TOOL_NAME}.`,
      isError: true,
    });
    expect(ran).toHaveLength(0);
  });

  it("keeps a duty's tool running for its holder where the row says Never", async () => {
    const holder = rulingsWith({
      setting: NEVER,
      toolName: "add_dependency",
      duties: ["shapes-initiatives"],
    });
    await expect(holder.callWith(input)).resolves.toMatchObject({ isError: false });
    expect(holder.ran).toHaveLength(1);

    const other = rulingsWith({ setting: NEVER, toolName: "add_dependency" });
    await expect(other.callWith(input)).resolves.toMatchObject({ isError: true });
    expect(other.ran).toHaveLength(0);
  });

  describe("on the person's own work and others'", () => {
    const split: AuthoritySetting = { kind: "own-and-others", own: ALLOWED, others: NEVER };

    it("rules a Task the person created by the own value", async () => {
      const { callWith, ran } = rulingsWith({ setting: split, ownTasks: ["task-1"] });

      await expect(callWith(input)).resolves.toMatchObject({ isError: false });
      expect(ran).toHaveLength(1);
    });

    it("rules another's Task by the others' value", async () => {
      const { callWith, ran } = rulingsWith({ setting: split, ownTasks: ["task-2"] });

      await expect(callWith(input)).resolves.toMatchObject({ isError: true });
      expect(ran).toHaveLength(0);
    });
  });
});

describe("the tools a session is offered", () => {
  const ADD_DEPENDENCY = "add_dependency";

  function placesWith(setting: AuthoritySetting, duties: readonly DutyKey[] = []) {
    const { roleCards } = heldCallsWith({ setting, switchKey: "initiativeRecords" });
    const registry = new OfficeToolRegistry();
    registry.register(aTaskTool([]));
    registry.register({
      ...aTaskTool([]),
      name: ADD_DEPENDENCY,
      authority: { group: "initiativeRecords", subject: () => ({ kind: "task", id: "t" }) },
    });
    const places = new SessionPlaces(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { heldBy: () => Promise.resolve(duties) } as unknown as Duties,
      registry,
      {} as never,
      {} as never,
      roleCards,
    );
    const offered = (stageThread: boolean, homeTools: readonly string[]) =>
      (
        places as unknown as {
          offeredTools(
            thread: unknown,
            held: readonly DutyKey[],
            home: readonly string[],
          ): Promise<string[]>;
        }
      ).offeredTools(aThread({ stageThread }), duties, homeTools);
    return { offered };
  }

  it("leaves out the tool of an Office action ruled Never and keeps the others", async () => {
    const { offered } = placesWith(NEVER);

    // taskRecords is Allowed in the Planner's card, initiativeRecords is Never.
    await expect(offered(false, ["open_decision"])).resolves.toEqual(
      expect.not.arrayContaining([ADD_DEPENDENCY]),
    );
    await expect(offered(false, ["open_decision"])).resolves.toContain("open_decision");
  });

  it("keeps a duty holder's duty tools offered where the row says Never", async () => {
    const { offered } = placesWith(NEVER, ["shapes-initiatives"]);

    await expect(offered(false, [])).resolves.toContain(ADD_DEPENDENCY);
  });

  it("gives a Stage's Thread only its Stage's tools, narrowed by the Authority, never widened", async () => {
    const { offered } = placesWith(ALLOWED);

    // The Stage lists open_decision only: the Allowed action tools are not added to it.
    await expect(offered(true, ["open_decision"])).resolves.toEqual(["open_decision"]);
    // A Never action tool in the Stage's list is left out all the same.
    const never = placesWith(NEVER);
    await expect(never.offered(true, ["open_decision", ADD_DEPENDENCY])).resolves.toEqual([
      "open_decision",
    ]);
  });
});
