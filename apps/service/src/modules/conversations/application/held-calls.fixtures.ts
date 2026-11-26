import type { ApprovalCall } from "../../engine/index.js";
import {
  sessionRole,
  type AuthorityGroup,
  type AuthoritySetting,
  type RoleCards,
} from "../../people/index.js";
import { APPROVAL_OPTIONS, approvalQuestion } from "../domain/consult.js";
import {
  oneOptionAnswer,
  type AnswerGivenBy,
  type Decision,
  type DecisionDraft,
} from "../domain/decision.js";
import { aDecision } from "../domain/decision.fixtures.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import { aThread } from "../domain/thread.fixtures.js";
import type { ThreadRepository } from "../ports/thread-repository.js";
import { ApprovalHolds } from "./approval-holds.js";
import { CallChains } from "./call-chains.js";
import { Consultations } from "./consultations.js";
import type { DecisionService } from "./decision-service.js";
import { FireAlarmInThreads } from "./fire-alarm-in-threads.js";
import { HeldCalls, type HeldCallRequest } from "./held-calls.js";
import type { ThreadRunner } from "./thread-runner.js";
import type { EventBus } from "../../../platform/events/event-bus.js";
import { aPlannerCard } from "./session-role.fixtures.js";

// What held-calls.test.ts and held-calls.full.test.ts share.

export const SESSION = "session-1";

export const CALL = "Set the Project's test command to: npm test.";

export const request: HeldCallRequest = {
  sessionId: SESSION,
  switchKey: "changeProjectSettings",
  call: CALL,
  context: "The Project has no test command.",
  why: "Tests keep regressions out.",
};

export interface Setup {
  /** The value of the caller's Authority row `switchKey`, Change Project settings when left out. */
  readonly setting: AuthoritySetting;
  readonly switchKey?: AuthorityGroup;
  /** The Roles someone fills besides the caller's. */
  readonly hired?: readonly string[];
  /** The hired people who may be consulted, by the key of their Role. */
  readonly consultants?: readonly string[];
  readonly answered?: readonly Decision[];
  readonly openRefusal?: string;
  readonly approvalHolds?: ApprovalHolds;
  /** The caller's Thread, as `aThread` takes it: a Thread on `task-1` when left out. */
  readonly thread?: Parameters<typeof aThread>[0];
}

/** The held calls with a Planner whose Authority row is as given, and the Decisions it opened. */
export function heldCallsWith({
  setting,
  switchKey = "changeProjectSettings",
  hired = [],
  consultants = [],
  answered = [],
  openRefusal,
  approvalHolds = new ApprovalHolds(),
  thread,
}: Setup) {
  const opened: DecisionDraft[] = [];
  const putTo: (string | undefined)[] = [];
  const spent = new Set<string>();
  const card = aPlannerCard({ authority: { ...aPlannerCard().authority, [switchKey]: setting } });
  const roleCards = {
    find: () => Promise.resolve(sessionRole("planner", 1, card, { kind: "ask-me" })),
    hiredKeys: () => Promise.resolve(new Set(["planner", ...hired])),
    roleTitle: (roleKey: string) => (roleKey === "cto" ? "CTO" : roleKey),
    consultants: () =>
      Promise.resolve(
        consultants.map((roleKey) => ({ roleKey, name: "Casey", title: roleKey.toUpperCase() })),
      ),
  } as unknown as RoleCards;
  const threads = {
    // A held call waits in a Thread on a Task, as only there it has a Decision to wait on.
    findBySession: () =>
      Promise.resolve(aThread({ home: { kind: "task", taskId: "task-1" }, ...thread })),
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
    new CallChains(threads),
    {} as EventBus,
  );
  return {
    heldCalls: new HeldCalls(roleCards, threads, consultations, approvalHolds),
    roleCards,
    threads,
    approvalHolds,
    opened,
    putTo,
  };
}

/** An approval of `words` (the held call when left out), answered with the option at `option`. */
export function anApproval(
  option: number,
  words: string = CALL,
  givenBy: AnswerGivenBy = {},
): Decision {
  return aDecision({
    kind: "approval",
    questions: [
      {
        kind: "choice",
        question: approvalQuestion(words),
        options: APPROVAL_OPTIONS,
        recommendation: { option: 0, reason: "It needs doing." },
      },
    ],
    answer: {
      ...oneOptionAnswer(option),
      ...givenBy,
      answeredAt: new Date("2026-10-25T09:05:00.000Z"),
    },
  });
}

/** A call of github/create_issue, waiting on approval as `setting` asks. */
export function call(
  input: unknown,
  setting: ApprovalCall["setting"] = { kind: "ask-me" },
): ApprovalCall {
  return { server: "github", tool: "create_issue", input, setting };
}
