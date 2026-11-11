import type { ApprovalCall } from "../../engine/index.js";
import type { HardSwitchValue, RoleCards } from "../../people/index.js";
import { approvalQuestion } from "../domain/consult.js";
import type { Decision, DecisionDraft } from "../domain/decision.js";
import { aDecision } from "../domain/decision.fixtures.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import { aThread } from "../domain/thread.fixtures.js";
import type { ThreadRepository } from "../ports/thread-repository.js";
import { ApprovalHolds } from "./approval-holds.js";
import { Consultations } from "./consultations.js";
import type { DecisionService } from "./decision-service.js";
import { FireAlarmInThreads } from "./fire-alarm-in-threads.js";
import { HeldCalls, type HeldCallRequest } from "./held-calls.js";
import type { ThreadRunner } from "./thread-runner.js";
import type { EventBus } from "../../../platform/events/event-bus.js";
import { aPlannerCard } from "./session-role.fixtures.js";

// What held-calls.test.ts and held-calls.full.test.ts share.

export const SESSION = "session-1";

export const CALL = "Change the Developer's instructions to: Write tests first.";

export const request: HeldCallRequest = {
  sessionId: SESSION,
  switchKey: "changeRoles",
  call: CALL,
  context: "The Developer skips tests.",
  why: "Tests keep regressions out.",
};

export interface Setup {
  readonly changeRoles: HardSwitchValue;
  /** The Roles someone fills besides the caller's. */
  readonly hired?: readonly string[];
  /** The hired people who may be consulted, by the key of their Role. */
  readonly consultants?: readonly string[];
  readonly answered?: readonly Decision[];
  readonly openRefusal?: string;
  readonly approvalHolds?: ApprovalHolds;
}

/** The held calls with a Planner whose Change Roles is as given, and the Decisions it opened. */
export function heldCallsWith({
  changeRoles,
  hired = [],
  consultants = [],
  answered = [],
  openRefusal,
  approvalHolds = new ApprovalHolds(),
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
    open: (_sessionId: string, draft: DecisionDraft, { putTo: to }: { putTo?: string } = {}) => {
      if (openRefusal) throw new ThreadRefused([openRefusal]);
      opened.push(draft);
      putTo.push(to);
      const decision = aDecision();
      return Promise.resolve({ decision, home: { kind: "task", taskId: decision.taskId } });
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
  return {
    heldCalls: new HeldCalls(roleCards, threads, consultations, approvalHolds),
    opened,
    putTo,
  };
}

/** An approval of the call, answered with the option at `option`. */
export function anApproval(option: number): Decision {
  return aDecision({
    question: approvalQuestion(CALL),
    options: ["Allow once", "Deny"],
    answer: { kind: "option", option, answeredAt: new Date("2026-10-25T09:05:00.000Z") },
  });
}

/** A call of github/create_issue, waiting on approval as `setting` asks. */
export function call(
  input: unknown,
  setting: ApprovalCall["setting"] = { kind: "ask-me" },
): ApprovalCall {
  return { server: "github", tool: "create_issue", input, setting };
}
