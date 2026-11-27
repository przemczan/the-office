import { describe, expect, it } from "vitest";
import { z } from "zod";
import { anOfficeToolCall } from "../../engine/index.fixtures.js";
import {
  OfficeToolRegistry,
  type OfficeTool,
  type OfficeToolAuthority,
  type OfficeToolCall,
} from "../../engine/index.js";
import type { AuthorityGroup, AuthoritySetting, Duties, DutyKey } from "../../people/index.js";
import { officeToolCallWords } from "../domain/office-tool-ruling.js";
import { aThread } from "../domain/thread.fixtures.js";
import { anApproval, heldCallsWith, SESSION, type Setup } from "./held-calls.fixtures.js";
import { ProposalService } from "./proposal-service.js";
import { OfficeToolRulings } from "./office-tool-rulings.js";
import { SessionPlaces } from "./session-places.js";
import type { WorkRecords } from "./work-records.js";

const ALLOWED = { kind: "allowed" } as const;
const NEVER = { kind: "never" } as const;
const ASK_ME = { kind: "ask-me" } as const;
const PROPOSAL = { kind: "proposal" } as const;
const CONSULT_CTO = { kind: "consult", role: "cto" } as const;

const TOOL_NAME = "change_task_title";

type ToolHooks = Pick<OfficeToolAuthority, "check" | "approvalLines" | "floor" | "groupsOf">;

/** A stand-in for the tool of an Office action of Task records, whose subject is its Task. */
function aTaskTool(
  ran: unknown[],
  calls: OfficeToolCall[] = [],
  name = TOOL_NAME,
  hooks: ToolHooks = {},
): OfficeTool {
  return {
    name,
    area: "work",
    description: "Changes a Task's title.",
    input: z.object({ taskId: z.string(), title: z.string() }),
    authority: {
      group: "taskRecords",
      title: "Change a Task's title",
      subject: (input) => ({ kind: "task", id: (input as { taskId: string }).taskId }),
      ...hooks,
    },
    run: (input, call) => {
      ran.push(input);
      calls.push(call);
      return Promise.resolve({ text: "Done.", isError: false });
    },
  };
}

/** A stand-in for Continue at a Gate: Gates and runs, with its own row on the person's own work. */
function aGateTool(ran: unknown[], calls: OfficeToolCall[], name: string): OfficeTool {
  return {
    ...aTaskTool(ran, calls, name),
    authority: {
      group: "gatesAndRuns",
      // Send back and Drop follow the group alone.
      ...(name === "continue_at_gate" && { onOwnWork: "continueAtGateOnOwnWork" }),
      title: "Continue at a Gate",
      subject: (given) => ({ kind: "task", id: (given as { taskId: string }).taskId }),
    },
  };
}

/** A stand-in for the tool of an Office action of Change Project settings, whose subject is its Project. */
function aProjectTool(
  ran: unknown[],
  calls: OfficeToolCall[],
  name: string,
  hooks: ToolHooks = {},
): OfficeTool {
  return {
    name,
    area: "projectsAndSettings",
    description: "Changes a Project's settings.",
    input: z.object({ project: z.string() }),
    authority: {
      group: "changeProjectSettings",
      title: "Change Project settings",
      subject: (input) => ({ kind: "project", id: (input as { project: string }).project }),
      ...hooks,
    },
    run: (input, call) => {
      ran.push(input);
      calls.push(call);
      return Promise.resolve({ text: "Done.", isError: false });
    },
  };
}

function toolOf(
  group: AuthorityGroup,
  ran: unknown[],
  calls: OfficeToolCall[],
  name: string,
  hooks?: ToolHooks,
): OfficeTool {
  switch (group) {
    case "taskRecords":
      return aTaskTool(ran, calls, name, hooks);
    case "gatesAndRuns":
      return aGateTool(ran, calls, name);
    default:
      return aProjectTool(ran, calls, name, hooks);
  }
}

interface Rulings extends Pick<Setup, "hired" | "consultants" | "answered" | "thread"> {
  readonly setting: AuthoritySetting;
  /** The Tasks the person created, whose work is their own. */
  readonly ownTasks?: readonly string[];
  readonly toolName?: string;
  /** The Authority group that rules the tool, Task records when left out. */
  readonly group?: AuthorityGroup;
  readonly hooks?: ToolHooks;
  /** Other rows of the card, stored as given. */
  readonly otherRows?: Setup["otherRows"];
  /** Gives the tool a draft of its change, so a Proposal can be made of it. */
  readonly withDraft?: boolean;
  /** Stands in for the Proposals' service. */
  readonly proposals?: object;
}

function rulingsWith({
  ownTasks = [],
  toolName = TOOL_NAME,
  group = "taskRecords",
  hooks,
  otherRows,
  withDraft = false,
  proposals = {},
  ...setup
}: Rulings) {
  const held = heldCallsWith({ ...setup, switchKey: group, ...(otherRows && { otherRows }) });
  const work = {
    isOwnWork: (_roleKey: string, { id }: { id: string }) => Promise.resolve(ownTasks.includes(id)),
  } as unknown as WorkRecords;
  const registry = new OfficeToolRegistry();
  const rulings = new OfficeToolRulings(
    held.threads,
    held.roleCards,
    held.heldCalls,
    work,
    held.approvalHolds,
    registry,
    proposals as unknown as ProposalService,
  );
  const ran: unknown[] = [];
  const calls: OfficeToolCall[] = [];
  const tool = toolOf(group, ran, calls, toolName, hooks);
  registry.register(
    withDraft
      ? {
          ...tool,
          draft: (given) =>
            Promise.resolve({
              subject: { kind: "task", id: "task-1", title: "A Task" },
              fields: [
                {
                  label: "Title",
                  before: "A",
                  after: (given as { title: string }).title,
                  form: "short",
                },
              ],
              fingerprint: { state: "ready" },
            }),
        }
      : tool,
  );
  const [ruled] = registry.named([toolName], rulings);
  const callWith = (input: unknown) =>
    (ruled as OfficeTool).run(input as never, anOfficeToolCall(SESSION));
  return { ...held, callWith, ran, calls };
}

const input = { taskId: "task-1", title: "New title" };

const touching = (...groups: string[]) => ({ groupsOf: () => Promise.resolve(groups) });
const rulesOf = (
  hooks: ToolHooks,
  otherRows: NonNullable<Setup["otherRows"]>,
  setting: AuthoritySetting = ALLOWED,
) =>
  rulingsWith({
    toolName: "change_project_settings",
    group: "changeProjectSettings",
    setting,
    hooks,
    otherRows,
  });

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

  it("refuses a call the tool's check refuses before holding it, so no approval is asked", async () => {
    const hooks = { check: () => Promise.resolve("The Office has no Task task-1.") };
    const asking = rulingsWith({ setting: ASK_ME, hooks });
    const allowed = rulingsWith({ setting: ALLOWED, hooks });

    const held = await asking.callWith(input);
    const run = await allowed.callWith(input);

    expect(held).toEqual({ text: "The Office has no Task task-1.", isError: true });
    expect(asking.opened).toHaveLength(0);
    expect(run).toEqual({ text: "The Office has no Task task-1.", isError: true });
    expect(allowed.ran).toEqual([]);
  });

  it("checks the repeat after Allow once again, against the state at that moment", async () => {
    const approval = anApproval(0, officeToolCallWords(TOOL_NAME, input));
    let refusal: string | undefined = "The Task is Done.";
    const { callWith, ran } = rulingsWith({
      setting: ASK_ME,
      answered: [approval],
      hooks: { check: () => Promise.resolve(refusal) },
    });

    const refused = await callWith(input);
    refusal = undefined;
    const repeated = await callWith(input);

    expect(refused.text).toBe("The Task is Done.");
    expect(repeated.isError).toBe(false);
    expect(ran).toEqual([input]);
  });

  it("lists the tool's approval lines on the card, and the generic words when it has none", async () => {
    const lined = rulingsWith({
      setting: ASK_ME,
      hooks: { approvalLines: () => Promise.resolve(["Title: New title"]) },
    });
    const plain = rulingsWith({ setting: ASK_ME });

    await lined.callWith(input);
    await plain.callWith(input);

    expect(lined.opened[0]?.context).toBe(
      `Your Role card asks for approval of each call of ${TOOL_NAME}. This call changes:\n- Title: New title`,
    );
    expect(plain.opened[0]?.context).toBe(
      `Your Role card asks for approval of each call of ${TOOL_NAME}.`,
    );
  });

  it("holds an Ask me call of a tool with a draft with the fields it changes on the card", async () => {
    const { callWith, opened } = rulingsWith({ setting: ASK_ME, withDraft: true });

    await callWith(input);

    expect(opened[0]?.questions[0]).toMatchObject({
      fields: [{ label: "Title", before: "A", after: "New title", form: "short" }],
    });
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

  it("holds a Proposal call of a tool with no draft as Ask me, with the user", async () => {
    const { callWith, putTo, ran } = rulingsWith({ setting: PROPOSAL });

    const held = await callWith(input);

    expect(held.text).toContain("waits on the user");
    expect(putTo).toEqual([undefined]);
    expect(ran).toHaveLength(0);
  });

  it("drafts a Proposal for a Proposal call of a tool with a draft, and answers at once", async () => {
    const drafted: unknown[] = [];
    const { callWith, opened, ran } = rulingsWith({
      setting: PROPOSAL,
      withDraft: true,
      proposals: { draft: (_session: string, change: unknown) => drafted.push(change) },
    });

    const answer = await callWith(input);

    expect(answer).toEqual({
      text: "Drafted a Proposal: Change a Task's title. The user applies it; go on.",
      isError: false,
    });
    expect(drafted).toMatchObject([
      { kind: "office-action", action: TOOL_NAME, input, outOfDate: false },
    ]);
    expect(ran).toHaveLength(0);
    expect(opened).toHaveLength(0);
  });

  it("reads Allowed as Proposal under the tool's floor, and keeps Never", async () => {
    const floored = { floor: () => Promise.resolve("proposal" as const) };
    const drafted: unknown[] = [];
    const proposals = { draft: (_session: string, change: unknown) => drafted.push(change) };

    const allowed = rulingsWith({ setting: ALLOWED, hooks: floored, withDraft: true, proposals });
    const answer = await allowed.callWith(input);
    const never = rulingsWith({ setting: NEVER, hooks: floored, withDraft: true, proposals });

    expect(answer.text).toContain("Drafted a Proposal");
    expect(drafted).toHaveLength(1);
    expect(allowed.ran).toHaveLength(0);
    await expect(never.callWith(input)).resolves.toMatchObject({ isError: true });
    expect(never.ran).toHaveLength(0);
  });

  it("runs an Allowed call whose floor says nothing", async () => {
    const { callWith, ran } = rulingsWith({
      setting: ALLOWED,
      hooks: { floor: () => Promise.resolve(undefined) },
    });

    await expect(callWith(input)).resolves.toMatchObject({ isError: false });
    expect(ran).toHaveLength(1);
  });

  it("refuses a call of a tool ruled Never as no such tool", async () => {
    const { callWith, ran } = rulingsWith({ setting: NEVER });

    await expect(callWith(input)).resolves.toEqual({
      text: `No Office tool is registered as ${TOOL_NAME}.`,
      isError: true,
    });
    expect(ran).toHaveLength(0);
  });

  it("refuses a call where the row says Never, whatever duty the person holds", async () => {
    // A duty grants no tool: the ruling takes no duty (spec 6, "A person's Office tools").
    const never = rulingsWith({ setting: NEVER, toolName: "add_dependency" });
    await expect(never.callWith(input)).resolves.toMatchObject({ isError: true });
    expect(never.ran).toHaveLength(0);
  });

  describe("a call that touches more than its tool's group (Change Project settings)", () => {
    const project = { project: "shop" };
    it("is ruled by the strictest group it touches: Allowed, but Secret values at Ask me holds it", async () => {
      const { callWith, ran, opened } = rulesOf(touching("secretValues"), {
        secretValues: ASK_ME,
      });

      await expect(callWith(project)).resolves.toMatchObject({ isError: true });
      expect(ran).toHaveLength(0);
      expect(opened).toHaveLength(1);
    });

    it("runs a call that touches no stricter group, whatever the others say", async () => {
      const { callWith, ran } = rulesOf(touching(), {
        secretValues: NEVER,
        publishingSettings: NEVER,
      });

      await expect(callWith(project)).resolves.toMatchObject({ isError: false });
      expect(ran).toHaveLength(1);
    });

    it.each([
      ["publishingSettings", ALLOWED],
      ["secretValues", CONSULT_CTO],
    ] as const)(
      "holds a call touching %s as Ask me where a hand-edited card stores it Allowed or Consult",
      async (group, stored) => {
        const { callWith, ran, opened } = rulesOf(touching(group), { [group]: stored });

        await expect(callWith(project)).resolves.toMatchObject({ isError: true });
        expect(ran).toHaveLength(0);
        expect(opened).toHaveLength(1);
      },
    );

    it("refuses up front, naming it, a call that touches a group at Never", async () => {
      const { callWith, ran, opened } = rulesOf(touching("publishingSettings", "secretValues"), {
        publishingSettings: NEVER,
        secretValues: ASK_ME,
      });

      const answer = await callWith(project);

      expect(answer.isError).toBe(true);
      expect(answer.text).toContain("Publishing settings is Never on your Role card");
      expect(ran).toHaveLength(0);
      expect(opened).toHaveLength(0);
    });
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

  describe("a tool with a row of its own on the person's own work (Continue at a Gate)", () => {
    const gate = { toolName: "continue_at_gate", group: "gatesAndRuns" } as const;
    const gateInput = { taskId: "task-1" };

    it("holds a call on own work at Ask me whatever Gates and runs says", async () => {
      const { callWith, ran, opened } = rulingsWith({
        ...gate,
        setting: ALLOWED,
        otherRows: { continueAtGateOnOwnWork: ASK_ME },
        ownTasks: ["task-1"],
      });

      await expect(callWith(gateInput)).resolves.toMatchObject({ isError: true });
      expect(ran).toHaveLength(0);
      expect(opened).toHaveLength(1);
    });

    it("holds a call on own work even where a hand-edited card stores Allowed or Consult", async () => {
      for (const stored of [ALLOWED, CONSULT_CTO]) {
        const { callWith, ran, opened } = rulingsWith({
          ...gate,
          setting: ALLOWED,
          otherRows: { continueAtGateOnOwnWork: stored },
          ownTasks: ["task-1"],
        });

        await expect(callWith(gateInput)).resolves.toMatchObject({ isError: true });
        expect(ran).toHaveLength(0);
        expect(opened).toHaveLength(1);
      }
    });

    it("rules a call on own work Never by its own row, though Gates and runs is Allowed", async () => {
      const { callWith, ran } = rulingsWith({
        ...gate,
        setting: ALLOWED,
        otherRows: { continueAtGateOnOwnWork: NEVER },
        ownTasks: ["task-1"],
      });

      await expect(callWith(gateInput)).resolves.toMatchObject({ isError: true });
      expect(ran).toHaveLength(0);
    });

    it("rules a call on another's work by Gates and runs", async () => {
      const { callWith, ran } = rulingsWith({
        ...gate,
        setting: ALLOWED,
        otherRows: { continueAtGateOnOwnWork: NEVER },
        ownTasks: ["task-2"],
      });

      await expect(callWith(gateInput)).resolves.toMatchObject({ isError: false });
      expect(ran).toHaveLength(1);
    });

    it("rules Send back and Drop, which have no own-work row, by Gates and runs alone", async () => {
      const { callWith, ran } = rulingsWith({
        toolName: "send_back_at_gate",
        group: "gatesAndRuns",
        setting: ALLOWED,
        otherRows: { continueAtGateOnOwnWork: NEVER },
        ownTasks: ["task-1"],
      });

      await expect(callWith(gateInput)).resolves.toMatchObject({ isError: false });
      expect(ran).toHaveLength(1);
    });
  });
});

describe("the tools a session is offered", () => {
  const ADD_DEPENDENCY = "add_dependency";
  const CHANGE_PROJECT_SETTINGS = "change_project_settings";

  /** The tools offered with `setting` in the group `switchKey`, the others as the Planner's card has them. */
  function placesWith(
    setting: AuthoritySetting,
    duties: readonly DutyKey[] = [],
    switchKey: AuthorityGroup = "initiativeRecords",
  ) {
    const { roleCards } = heldCallsWith({ setting, switchKey });
    const registry = new OfficeToolRegistry();
    registry.register(aTaskTool([]));
    registry.register({
      ...aTaskTool([]),
      name: ADD_DEPENDENCY,
      authority: {
        group: "initiativeRecords",
        title: "Add a dependency",
        subject: () => ({ kind: "task", id: "t" }),
      },
    });
    registry.register(aProjectTool([], [], CHANGE_PROJECT_SETTINGS));
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
      {} as never,
      {} as never,
    );
    const offered = (stageThread: boolean, homeTools: readonly string[]) =>
      (
        places as unknown as {
          offeredTools(thread: unknown, home: readonly string[]): Promise<string[]>;
        }
      ).offeredTools(aThread({ stageThread }), homeTools);
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

  it("leaves a duty holder's tools out where the row says Never: a duty grants none", async () => {
    const { offered } = placesWith(NEVER, ["shapes-initiatives"]);

    await expect(offered(false, [])).resolves.not.toContain(ADD_DEPENDENCY);
  });

  it("offers a hand-written tool by its group, leaving it out at Never, and Core tools always", async () => {
    const { offered } = placesWith(NEVER, [], "postLinkCard");

    const never = await offered(false, ["post_link_card", "read_repository"]);
    expect(never).toContain("read_repository");
    expect(never).not.toContain("post_link_card");
    const allowed = placesWith(ALLOWED, [], "postLinkCard");
    await expect(allowed.offered(false, ["post_link_card", "read_repository"])).resolves.toEqual(
      expect.arrayContaining(["post_link_card", "read_repository"]),
    );
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

  it("leaves change_project_settings out of a Stage's list where the setting is Never, as the Reviewer's is", async () => {
    // The Reviewer's preset is Never for Change Project settings (presets.full.test.ts pins it).
    const { offered } = placesWith(NEVER, [], "changeProjectSettings");

    await expect(offered(true, [TOOL_NAME, CHANGE_PROJECT_SETTINGS])).resolves.toEqual([TOOL_NAME]);
  });

  it("refuses a Stage's call on another Task than its own, whatever the setting", async () => {
    const stage = { stageThread: true };
    const other = rulingsWith({ setting: ALLOWED, thread: stage });
    const own = rulingsWith({ setting: ALLOWED, thread: stage });

    const refused = await other.callWith({ ...input, taskId: "task-2" });
    await own.callWith(input);

    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("this Stage's own Task only");
    expect(other.ran).toEqual([]);
    expect(own.ran).toEqual([input]);
  });

  it("rules a call from a chat, with no Task, by the Change Project settings Authority", async () => {
    const chat = { home: { kind: "chat", roleKey: "planner" } } as const;
    const call = { project: "project-1" };
    const allowed = rulingsWith({
      setting: ALLOWED,
      group: "changeProjectSettings",
      toolName: "change_project_settings",
      thread: chat,
    });
    const asking = rulingsWith({
      setting: ASK_ME,
      group: "changeProjectSettings",
      toolName: "change_project_settings",
      thread: chat,
    });

    await allowed.callWith(call);
    const held = await asking.callWith(call);

    expect(allowed.ran).toEqual([call]);
    expect(held.isError).toBe(true);
    expect(held.text).toContain("waits on the user");
    expect(asking.ran).toEqual([]);
    expect(asking.opened).toHaveLength(1);
  });
});
