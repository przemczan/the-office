import type {
  Initiative,
  LiveAgent,
  LivePerson,
  LiveView,
  RunningTask,
  TaskSummary,
} from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { workingAgentsOf, type WorkingAgentRecords } from "./working-agents.ts";

const TASK_ID = "3f2a1b0c-4d5e-4f6a-8b7c-9d0e1f2a3b4c";
const INITIATIVE_ID = "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

function aTask(fields: Pick<TaskSummary, "title" | "state" | "projectId">): TaskSummary {
  return { id: TASK_ID, madeFor: null, ...fields } as TaskSummary;
}

function anInitiative(state: Initiative["state"]): Initiative {
  return { id: INITIATIVE_ID, name: "Onboarding", state, projectIds: ["p1", "p2"] } as Initiative;
}

function anAgent(fields: Partial<LiveAgent> & Pick<LiveAgent, "threadId" | "home">): LiveAgent {
  return { kind: "thread", consultation: null, engine: null, since: null, ...fields };
}

function aPerson(roleKey: string, agents: LiveAgent[]): LivePerson {
  return {
    roleKey,
    name: roleKey.toUpperCase(),
    title: "Role",
    state: "working",
    agents,
    consulting: [],
    waitingOnYou: [],
    idleSince: null,
  };
}

function viewOf(...people: LivePerson[]): LiveView {
  return { people };
}

const NO_RECORDS: WorkingAgentRecords = { tasks: [], initiatives: [], running: [] };
const TASK_HOME = { kind: "task", taskId: TASK_ID } as const;
const INITIATIVE_HOME = { kind: "initiative", initiativeId: INITIATIVE_ID } as const;

describe("workingAgentsOf", () => {
  it("words a Stage by its name, with its Task, Projects, engine and stand-in", () => {
    const running = {
      taskId: TASK_ID,
      stage: {
        key: "implement",
        name: "Implement",
        role: "dev",
        since: "2026-11-27T09:00:00.000Z",
      },
    } as RunningTask;
    const agent = anAgent({
      threadId: "t1",
      home: TASK_HOME,
      kind: "stage",
      since: "2026-11-27T09:00:00.000Z",
      engine: {
        engineId: "personal",
        engineName: "Personal",
        standInFor: { engineId: "work", engineName: "Work", reason: "used up" },
      },
    });

    const [row] = workingAgentsOf(viewOf(aPerson("dev", [agent])), {
      ...NO_RECORDS,
      tasks: [aTask({ title: "Add a filter", state: "in-progress", projectId: "p1" })],
      running: [running],
    });

    expect(row).toMatchObject({
      personName: "DEV",
      badge: "Implement",
      title: "Add a filter",
      target: { kind: "task", taskId: TASK_ID, threadId: "t1" },
      projectIds: ["p1"],
      engineWords: "on Personal, standing in for Work",
      since: "2026-11-27T09:00:00.000Z",
    });
  });

  it("words a Task's other Thread as Planning while the Task plans, else as a Thread", () => {
    const agent = anAgent({ threadId: "t1", home: TASK_HOME });
    const view = viewOf(aPerson("planner", [agent]));

    const planning = workingAgentsOf(view, {
      ...NO_RECORDS,
      tasks: [aTask({ title: "A", state: "planning", projectId: "p1" })],
    });
    const other = workingAgentsOf(view, {
      ...NO_RECORDS,
      tasks: [aTask({ title: "A", state: "backlog", projectId: "p1" })],
    });

    expect([planning[0]?.badge, other[0]?.badge]).toEqual(["Planning", "Thread"]);
  });

  it("words an Initiative's Thread as Shaping while it shapes, else as Planning", () => {
    const view = viewOf(aPerson("planner", [anAgent({ threadId: "t1", home: INITIATIVE_HOME })]));

    const shaping = workingAgentsOf(view, {
      ...NO_RECORDS,
      initiatives: [anInitiative("shaping")],
    });
    const active = workingAgentsOf(view, { ...NO_RECORDS, initiatives: [anInitiative("active")] });

    expect(shaping[0]).toMatchObject({
      badge: "Shaping",
      title: "Onboarding",
      projectIds: ["p1", "p2"],
      target: { kind: "initiative", initiativeId: INITIATIVE_ID, threadId: "t1" },
    });
    expect(active[0]?.badge).toBe("Planning");
  });

  it("words a Consultation for whoever asked, and a chat with the user", () => {
    const consultation = anAgent({
      threadId: "t1",
      home: TASK_HOME,
      kind: "consultation",
      consultation: { decisionId: crypto.randomUUID(), askerRoleKey: "dev" },
    });
    const byTheOffice = anAgent({
      threadId: "t2",
      home: TASK_HOME,
      kind: "consultation",
      consultation: { decisionId: crypto.randomUUID(), askerRoleKey: null },
    });
    const chat = anAgent({ threadId: "t3", home: { kind: "chat", roleKey: "cto" } });

    const rows = workingAgentsOf(
      viewOf(aPerson("dev", []), aPerson("cto", [consultation, byTheOffice, chat])),
      NO_RECORDS,
    );

    expect(rows.map(({ badge, title }) => [badge, title])).toEqual([
      ["Consultation", "for DEV"],
      ["Consultation", "for The Office"],
      ["Chat", "with you"],
    ]);
    expect(rows[2]).toMatchObject({
      target: { kind: "chat", roleKey: "cto", threadId: "t3" },
      projectIds: [],
    });
  });

  it("lists the longest-working first, and one with no known start last", () => {
    const view = viewOf(
      aPerson("a", [anAgent({ threadId: "unknown", home: TASK_HOME })]),
      aPerson("b", [
        anAgent({ threadId: "newer", home: TASK_HOME, since: "2026-11-27T10:00:00.000Z" }),
        anAgent({ threadId: "older", home: TASK_HOME, since: "2026-11-27T09:00:00.000Z" }),
      ]),
    );

    const rows = workingAgentsOf(view, NO_RECORDS);

    expect(rows.map(({ threadId }) => threadId)).toEqual(["older", "newer", "unknown"]);
  });
});
