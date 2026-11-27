import { describe, expect, it } from "vitest";
import { decisionSummary } from "./decision.js";
import { aDecision } from "./decision.fixtures.js";
import {
  liveViewOf,
  type HiredPerson,
  type LivePerson,
  type LiveViewRecords,
} from "./live-view.js";
import type { Thread } from "./thread.js";
import { aThread } from "./thread.fixtures.js";

const TASK = "3b1f6f0e-2a4d-4c8e-9f1a-7d2e5c6b8a90";
const INITIATIVE = "7c2e1d4a-5b3f-4e6a-8d9c-0a1b2c3d4e5f";
const HIRED = new Date("2026-11-01T09:00:00.000Z");
const FIRST = new Date("2026-11-05T09:00:00.000Z");
const LATER = new Date("2026-11-05T10:00:00.000Z");

const OSCAR: HiredPerson = {
  roleKey: "developer",
  name: "Oscar",
  title: "Developer",
  hiredAt: HIRED,
};
const CLARA: HiredPerson = { roleKey: "cto", name: "Clara", title: "CTO", hiredAt: HIRED };

function threadOf(roleKey: string, fields: Partial<Thread> = {}): Thread {
  return aThread({
    id: crypto.randomUUID(),
    home: { kind: "task", taskId: TASK },
    roleKey,
    ...fields,
  });
}

function liveView(records: Partial<LiveViewRecords>): readonly LivePerson[] {
  return liveViewOf({
    people: [OSCAR, CLARA],
    threads: [],
    lastCalls: new Map(),
    engineNames: new Map(),
    ...records,
  }).people;
}

function personIn(people: readonly LivePerson[], roleKey: string): LivePerson {
  const person = people.find((one) => one.roleKey === roleKey);
  if (!person) throw new Error(`${roleKey} isn't listed`);
  return person;
}

describe("what each person is doing now", () => {
  it("lists everyone filling a Role, in hiring order, idle with nothing going on", () => {
    const idle = { state: "idle", agents: [], consulting: [], waitingOnYou: [], idleSince: HIRED };

    expect(liveView({})).toEqual([
      { roleKey: "developer", name: "Oscar", title: "Developer", ...idle },
      { roleKey: "cto", name: "Clara", title: "CTO", ...idle },
    ]);
  });

  it("shows one Agent for each Thread the person answers in, with its home and kind", () => {
    const stage = threadOf("developer", {
      state: "answering",
      stageThread: true,
      startedAt: FIRST,
    });
    const own = threadOf("developer", { state: "answering", startedAt: LATER });
    const chat = threadOf("developer", {
      state: "answering",
      home: { kind: "chat", roleKey: "developer" },
      startedAt: LATER,
    });

    const oscar = personIn(liveView({ threads: [own, chat, stage] }), "developer");

    expect(oscar.state).toBe("working");
    expect(oscar.agents).toEqual([
      { threadId: stage.id, home: stage.home, kind: "stage", consultation: undefined },
      { threadId: own.id, home: own.home, kind: "thread", consultation: undefined },
      { threadId: chat.id, home: chat.home, kind: "thread", consultation: undefined },
    ]);
    expect(oscar.idleSince).toBeUndefined();
  });

  it("gives each Agent since when its turn runs, and none for a turn running before it was kept", () => {
    const kept = threadOf("developer", { state: "answering", answeringSince: LATER });
    const unkept = threadOf("developer", { state: "answering", startedAt: LATER });

    const { agents } = personIn(liveView({ threads: [kept, unkept] }), "developer");

    expect(agents.map(({ since }) => since)).toEqual([LATER, undefined]);
  });

  it("doesn't count a Thread that isn't answering", () => {
    const oscar = personIn(liveView({ threads: [threadOf("developer")] }), "developer");

    expect(oscar.state).toBe("idle");
  });

  it("doesn't count a Stage Thread waiting on its Decision, but counts an Initiative's Thread", () => {
    const decision = aDecision({ roleKey: "developer" });
    const stage = threadOf("developer", {
      state: "answering",
      stageThread: true,
      openDecisions: [decision],
    });
    const planning = threadOf("cto", {
      state: "answering",
      home: { kind: "initiative", initiativeId: INITIATIVE },
      openDecisions: [aDecision({ roleKey: "cto" })],
    });

    const people = liveView({ threads: [stage, planning] });

    expect(personIn(people, "developer").agents).toEqual([]);
    expect(personIn(people, "cto").agents).toEqual([
      { threadId: planning.id, home: planning.home, kind: "thread", consultation: undefined },
    ]);
  });

  it("shows a Decision put to a Consultant as consulting, and the Consultation as their Agent", () => {
    const decision = aDecision({ roleKey: "developer", putTo: "cto", askedAt: FIRST });
    const stage = threadOf("developer", {
      state: "answering",
      stageThread: true,
      openDecisions: [decision],
    });
    const consultation = threadOf("cto", {
      state: "answering",
      consultation: { decisionId: decision.id, askerThreadId: stage.id, askerRoleKey: "developer" },
    });

    const people = liveView({ threads: [stage, consultation] });

    expect(personIn(people, "developer")).toMatchObject({
      state: "consulting",
      agents: [],
      consulting: [
        {
          decisionId: decision.id,
          threadId: stage.id,
          home: stage.home,
          consultantRoleKey: "cto",
          question: decisionSummary(decision),
          since: FIRST,
        },
      ],
      waitingOnYou: [],
    });
    expect(personIn(people, "cto")).toMatchObject({
      state: "working",
      agents: [
        {
          threadId: consultation.id,
          home: consultation.home,
          kind: "consultation",
          consultation: { decisionId: decision.id, askerRoleKey: "developer" },
        },
      ],
    });
  });

  it("names the Consultant a Decision was passed on to", () => {
    const decision = aDecision({
      roleKey: "developer",
      putTo: "devops",
      passedOn: [{ roleKey: "cto", reason: "Devops knows the machine.", passedOnAt: LATER }],
    });

    const oscar = personIn(
      liveView({
        threads: [threadOf("developer", { stageThread: true, openDecisions: [decision] })],
      }),
      "developer",
    );

    expect(oscar.consulting.map(({ consultantRoleKey }) => consultantRoleKey)).toEqual(["devops"]);
  });

  it("shows a Decision waiting on the user as waiting on you", () => {
    const decision = aDecision({ roleKey: "developer", askedAt: FIRST });
    const stage = threadOf("developer", { stageThread: true, openDecisions: [decision] });

    const oscar = personIn(liveView({ threads: [stage] }), "developer");

    expect(oscar).toMatchObject({
      state: "waiting-on-you",
      waitingOnYou: [
        {
          decisionId: decision.id,
          threadId: stage.id,
          home: stage.home,
          byTheOffice: false,
          question: decisionSummary(decision),
          since: FIRST,
        },
      ],
      idleSince: undefined,
    });
  });

  it("shows The Office's Decision on a Stage out of tries on the person whose Thread it is in", () => {
    const outOfTries = aDecision({ roleKey: undefined });
    const stage = threadOf("developer", { stageThread: true, openDecisions: [outOfTries] });

    const oscar = personIn(liveView({ threads: [stage] }), "developer");

    expect(oscar.state).toBe("waiting-on-you");
    expect(oscar.waitingOnYou.map(({ byTheOffice }) => byTheOffice)).toEqual([true]);
  });

  it("shows The Office's Decision put to someone first as consulting", () => {
    const outOfTries = aDecision({ roleKey: undefined, putTo: "cto" });
    const stage = threadOf("developer", { stageThread: true, openDecisions: [outOfTries] });

    const oscar = personIn(liveView({ threads: [stage] }), "developer");

    expect(oscar.state).toBe("consulting");
    expect(oscar.consulting.map(({ consultantRoleKey }) => consultantRoleKey)).toEqual(["cto"]);
  });

  it("lists every activity, leading with waiting on you, then consulting, then working", () => {
    const asked = aDecision({ roleKey: "developer", putTo: "cto", askedAt: FIRST });
    const waiting = aDecision({ roleKey: "developer", askedAt: LATER });
    const consultingThread = threadOf("developer", { stageThread: true, openDecisions: [asked] });
    const waitingThread = threadOf("developer", { openDecisions: [waiting] });
    const chat = threadOf("developer", {
      state: "answering",
      home: { kind: "chat", roleKey: "developer" },
    });

    const all = personIn(
      liveView({ threads: [consultingThread, waitingThread, chat] }),
      "developer",
    );
    const withoutWaiting = personIn(liveView({ threads: [consultingThread, chat] }), "developer");

    expect(all.state).toBe("waiting-on-you");
    expect([all.agents.length, all.consulting.length, all.waitingOnYou.length]).toEqual([1, 1, 1]);
    expect(withoutWaiting.state).toBe("consulting");
  });

  it("leaves out people let go and Roles nobody fills, with their Threads", () => {
    const people = liveView({
      people: [OSCAR],
      threads: [
        threadOf("cto", { state: "answering" }),
        threadOf("reviewer", { state: "answering" }),
      ],
    });

    expect(people.map(({ roleKey }) => roleKey)).toEqual(["developer"]);
    expect(people[0]?.state).toBe("idle");
  });

  it("is idle since the last engine call's end when it came after the hiring", () => {
    const people = liveView({ lastCalls: new Map([["developer", LATER]]) });

    expect(personIn(people, "developer").idleSince).toEqual(LATER);
  });

  it("is idle since the hiring when the last engine call came before it", () => {
    const before = new Date("2026-10-01T09:00:00.000Z");

    const people = liveView({ lastCalls: new Map([["developer", before]]) });

    expect(personIn(people, "developer").idleSince).toEqual(HIRED);
  });
});
