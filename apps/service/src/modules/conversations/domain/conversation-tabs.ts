import { decisionSummary, formAnswerWords, isOpen, type Decision } from "./decision.js";
import { isPersonsThread, type Thread } from "./thread.js";

/** A Consultation on the Task, from the moment it starts. */
export interface TabConsultation {
  readonly threadId: string;
  readonly decisionId: string;
  /** The Decision in one line: its first question, and how many more it asks. */
  readonly question: string;
  /** The Consultant's answer, in words; undefined while the Consultation waits on them. */
  readonly note: string | undefined;
  readonly answeredAt: Date | undefined;
}

/**
 * The Initiative's planning Thread a Task is planned in (Plan the Initiative), which counts as its
 * planning Thread: no Thread of whoever holds Plans opens on the Task meanwhile.
 */
export interface PlanningThreadElsewhere {
  readonly initiativeId: string;
  readonly threadId: string;
}

/** One person's tab in a Task's conversation (spec §2.4). */
export interface ConversationTab {
  readonly roleKey: string;
  /** Their one Thread on the Task; undefined until it is opened. */
  readonly threadId: string | undefined;
  /**
   * On the tab of whoever holds Plans, while the Task is planned in its Initiative's planning
   * Thread.
   */
  readonly planningThreadElsewhere: PlanningThreadElsewhere | undefined;
  readonly stageRunning: boolean;
  /** In the order answered, then those still waiting on the Consultant. */
  readonly consultations: readonly TabConsultation[];
}

/**
 * The Task's tabs, from its Threads and the Decisions its Consultations were opened for: whoever
 * holds Plans (`planner`, none while nobody does), then each person who ran an Agent Stage in the
 * order they first worked, then each Consultant of a Decision on the Task, from the moment the
 * Consultation starts. The planner's tab points to the Initiative's planning Thread while the Task
 * is planned there.
 */
export function conversationTabs(
  planner: string | undefined,
  threads: readonly Thread[],
  decisions: readonly Decision[],
  planningThreadElsewhere?: PlanningThreadElsewhere,
): ConversationTab[] {
  const oldestFirst = threads.toSorted(
    (one, other) => one.startedAt.getTime() - other.startedAt.getTime(),
  );
  const consultations = consultationsOfConsultants(oldestFirst, decisions);
  const people = new Set([
    ...(planner === undefined ? [] : [planner]),
    ...oldestFirst.filter(({ stageThread }) => stageThread).map(({ roleKey }) => roleKey),
    ...consultations.map(({ roleKey }) => roleKey),
  ]);
  return [...people].map((roleKey) => {
    const own = oldestFirst.filter((thread) => thread.roleKey === roleKey);
    return {
      roleKey,
      threadId: own.find(isPersonsThread)?.id,
      planningThreadElsewhere: roleKey === planner ? planningThreadElsewhere : undefined,
      stageRunning: own.some(({ stageThread, state }) => stageThread && state === "answering"),
      consultations: consultations
        .filter((consultation) => consultation.roleKey === roleKey)
        .map(({ consultation }) => consultation),
    };
  });
}

/**
 * Each Consultation waiting on its Consultant or answered by them, in the order answered, waiting
 * ones last. One the user took over, or the Consultant passed on, is no longer theirs.
 */
function consultationsOfConsultants(
  threads: readonly Thread[],
  decisions: readonly Decision[],
): readonly { readonly roleKey: string; readonly consultation: TabConsultation }[] {
  return threads
    .flatMap(({ id, roleKey, consultation }) => {
      const decision = decisions.find((candidate) => candidate.id === consultation?.decisionId);
      if (!decision || !isConsultantsOwn(decision, roleKey)) return [];
      const { answer } = decision;
      return [
        {
          roleKey,
          consultation: {
            threadId: id,
            decisionId: decision.id,
            question: decisionSummary(decision),
            note: answer && formAnswerWords(decision, answer),
            answeredAt: answer?.answeredAt,
          },
        },
      ];
    })
    .toSorted(
      (one, other) =>
        answeredTime(one.consultation.answeredAt) - answeredTime(other.consultation.answeredAt),
    );
}

/**
 * A Consultation on a Task that no longer waits on its Consultant, `decision` being the one it was
 * opened for (undefined once gone): answered, taken over, passed on or closed. Its tab shows only its
 * note then, so nothing in its log, a Proposal's card included, can be opened again. One in a chat
 * stays in the callee's Thread list, and isn't closed in this sense.
 */
export function isClosedConsultationOnTask(
  { home, roleKey, consultation }: Pick<Thread, "home" | "roleKey" | "consultation">,
  decision: Decision | undefined,
): boolean {
  if (home.kind !== "task" || !consultation) return false;
  return !decision || !isOpen(decision) || decision.putTo !== roleKey;
}

function isConsultantsOwn({ answer, putTo }: Decision, roleKey: string): boolean {
  return answer ? answer.answeredBy === roleKey : putTo === roleKey;
}

function answeredTime(answeredAt: Date | undefined): number {
  return answeredAt?.getTime() ?? Number.POSITIVE_INFINITY;
}
