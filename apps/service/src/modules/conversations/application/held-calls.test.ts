import { describe, expect, it } from "vitest";
import type { HardSwitchValue, RoleCards } from "../../people/index.js";
import { approvalQuestion } from "../domain/consult.js";
import type { Decision, DecisionDraft } from "../domain/decision.js";
import { aDecision } from "../domain/decision.fixtures.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import { aThread } from "../domain/thread.fixtures.js";
import type { ThreadRepository } from "../ports/thread-repository.js";
import { Consultations } from "./consultations.js";
import type { DecisionService } from "./decision-service.js";
import { FireAlarmInThreads } from "./fire-alarm-in-threads.js";
import { HeldCalls, type HeldCallRequest } from "./held-calls.js";
import type { ThreadRunner } from "./thread-runner.js";
import type { EventBus } from "../../../platform/events/event-bus.js";
import { aPlannerCard } from "./session-role.fixtures.js";

const SESSION = "session-1";
const CALL = "Change the Developer's instructions to: Write tests first.";

const request: HeldCallRequest = {
  sessionId: SESSION,
  switchKey: "changeRoles",
  call: CALL,
  context: "The Developer skips tests.",
  why: "Tests keep regressions out.",
};

interface Setup {
  readonly changeRoles: HardSwitchValue;
  /** The Roles someone fills besides the caller's. */
  readonly hired?: readonly string[];
  /** The hired people who may be consulted, by the key of their Role. */
  readonly consultants?: readonly string[];
  readonly answered?: readonly Decision[];
  readonly openRefusal?: string;
}

/** The held calls with a Planner whose Change Roles is as given, and the Decisions it opened. */
function heldCallsWith({
  changeRoles,
  hired = [],
  consultants = [],
  answered = [],
  openRefusal,
}: Setup) {
  const opened: DecisionDraft[] = [];
  const putTo: (string | undefined)[] = [];
  const spent = new Set<string>();
  const card = aPlannerCard({
    hardSwitches: { ...aPlannerCard().hardSwitches, changeRoles },
  });
  const roleCards = {
    find: () => Promise.resolve({ roleKey: "planner", cardVersion: 1, card }),
    hiredKeys: () => Promise.resolve(new Set(["planner", ...hired])),
    roleTitle: (roleKey: string) => (roleKey === "cto" ? "CTO" : roleKey),
    consultants: () =>
      Promise.resolve(
        consultants.map((roleKey) => ({ roleKey, name: "Casey", title: roleKey.toUpperCase() })),
      ),
  } as unknown as RoleCards;
  const threads = {
    findBySession: () => Promise.resolve(aThread()),
    decisionsIn: () => Promise.resolve(answered),
    spendApproval: (id: string) => {
      const unspent = !spent.has(id);
      spent.add(id);
      return Promise.resolve(unspent);
    },
  } as unknown as ThreadRepository;
  const decisions = {
    open: (_sessionId: string, draft: DecisionDraft, to?: string) => {
      if (openRefusal) throw new ThreadRefused([openRefusal]);
      opened.push(draft);
      putTo.push(to);
      return Promise.resolve(aDecision());
    },
  } as unknown as DecisionService;
  const consultations = new Consultations(
    roleCards,
    threads,
    decisions,
    {} as ThreadRunner,
    new FireAlarmInThreads(),
    {} as EventBus,
  );
  return { heldCalls: new HeldCalls(roleCards, threads, consultations), opened, putTo };
}

/** An approval of the call, answered with the option at `option`. */
function anApproval(option: number): Decision {
  return aDecision({
    question: approvalQuestion(CALL),
    options: ["Allow once", "Deny"],
    answer: { kind: "option", option, answeredAt: new Date("2026-10-25T09:05:00.000Z") },
  });
}

describe("a call behind Change Roles", () => {
  it("runs when the switch is Allowed", async () => {
    const { heldCalls, opened } = heldCallsWith({ changeRoles: { kind: "allowed" } });

    await expect(heldCalls.hold(request)).resolves.toEqual({ kind: "proceed" });
    expect(opened).toEqual([]);
  });

  it("is refused at once, with the reason, when the switch is Never", async () => {
    const { heldCalls, opened } = heldCallsWith({ changeRoles: { kind: "never" } });

    const outcome = await heldCalls.hold(request);

    expect(outcome).toMatchObject({ kind: "refused" });
    expect(outcome).toHaveProperty("reason", expect.stringContaining("Change Roles is Never"));
    expect(opened).toEqual([]);
  });

  it("waits on the user for an approval when the switch is Ask me", async () => {
    const { heldCalls, opened } = heldCallsWith({ changeRoles: { kind: "ask-me" } });

    await expect(heldCalls.hold(request)).resolves.toEqual({ kind: "held", waitingOn: "the user" });
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({
      question: approvalQuestion(CALL),
      options: ["Allow once", "Deny"],
    });
  });

  it("waits on the Consultant in a Consultation when the switch is Consult", async () => {
    const { heldCalls, opened, putTo } = heldCallsWith({
      changeRoles: { kind: "consult", role: "cto" },
      hired: ["cto"],
      consultants: ["cto"],
    });

    await expect(heldCalls.hold(request)).resolves.toEqual({
      kind: "held",
      waitingOn: "Casey, in a Consultation on this Task",
    });
    expect(putTo).toEqual(["cto"]);
    expect(opened[0]?.context).not.toContain("For CTO:");
  });

  it("waits on the user in place of a hired person who is not a Consultant", async () => {
    const { heldCalls, opened, putTo } = heldCallsWith({
      changeRoles: { kind: "consult", role: "cto" },
      hired: ["cto"],
    });

    await expect(heldCalls.hold(request)).resolves.toEqual({
      kind: "held",
      waitingOn: "the user in place of CTO",
    });
    expect(putTo).toEqual([undefined]);
    expect(opened[0]?.context).toContain("For CTO:");
  });

  it("falls back to the user when nobody fills the Role to consult", async () => {
    const { heldCalls, opened } = heldCallsWith({ changeRoles: { kind: "consult", role: "cto" } });

    await expect(heldCalls.hold(request)).resolves.toEqual({ kind: "held", waitingOn: "the user" });
    expect(opened[0]?.context).not.toContain("For CTO:");
  });

  it('runs once after "Allow once", and waits again for the next call', async () => {
    const { heldCalls, opened } = heldCallsWith({
      changeRoles: { kind: "ask-me" },
      answered: [anApproval(0)],
    });

    await expect(heldCalls.hold(request)).resolves.toEqual({ kind: "proceed" });
    await expect(heldCalls.hold(request)).resolves.toMatchObject({ kind: "held" });
    expect(opened).toHaveLength(1);
  });

  it('waits again after "Deny"', async () => {
    const { heldCalls, opened } = heldCallsWith({
      changeRoles: { kind: "ask-me" },
      answered: [anApproval(1)],
    });

    await expect(heldCalls.hold(request)).resolves.toMatchObject({ kind: "held" });
    expect(opened).toHaveLength(1);
  });

  it("does not take an approval of another call as its own", async () => {
    const other = aDecision({
      ...anApproval(0),
      question: approvalQuestion("Change the Reviewer's instructions."),
    });
    const { heldCalls } = heldCallsWith({ changeRoles: { kind: "ask-me" }, answered: [other] });

    await expect(heldCalls.hold(request)).resolves.toMatchObject({ kind: "held" });
  });

  it("is refused with the reason when the Thread can't hold a Decision", async () => {
    const { heldCalls } = heldCallsWith({
      changeRoles: { kind: "ask-me" },
      openRefusal: "A chat has no Decisions.",
    });

    await expect(heldCalls.hold(request)).resolves.toEqual({
      kind: "refused",
      reason: "A chat has no Decisions.",
    });
  });
});
