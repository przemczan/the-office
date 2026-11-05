import { answerWords, type Decision } from "./decision.js";
import { isPersonsThread, type Thread } from "./thread.js";

/** A Consultation a Consultant answered on the Task. */
export interface TabConsultation {
  readonly threadId: string;
  readonly decisionId: string;
  readonly question: string;
  /** The Consultant's answer, in words. */
  readonly note: string;
  readonly answeredAt: Date;
}

/** One person's tab in a Task's conversation (spec §2.4). */
export interface ConversationTab {
  readonly roleKey: string;
  /** Their one Thread on the Task; undefined until it is opened. */
  readonly threadId: string | undefined;
  readonly stageRunning: boolean;
  /** In the order answered. */
  readonly consultations: readonly TabConsultation[];
}

/**
 * The Task's tabs, from its Threads and the Decisions its Consultations were opened for: the
 * Planner, then each person who ran an Agent Stage in the order they first worked, then each
 * Consultant who answered a Decision on the Task.
 */
export function conversationTabs(
  planner: string,
  threads: readonly Thread[],
  decisions: readonly Decision[],
): ConversationTab[] {
  const oldestFirst = threads.toSorted(
    (one, other) => one.startedAt.getTime() - other.startedAt.getTime(),
  );
  const consultations = answeredConsultations(oldestFirst, decisions);
  const people = new Set([
    planner,
    ...oldestFirst.filter(({ stageThread }) => stageThread).map(({ roleKey }) => roleKey),
    ...consultations.map(({ roleKey }) => roleKey),
  ]);
  return [...people].map((roleKey) => {
    const own = oldestFirst.filter((thread) => thread.roleKey === roleKey);
    return {
      roleKey,
      threadId: own.find(isPersonsThread)?.id,
      stageRunning: own.some(({ stageThread, state }) => stageThread && state === "answering"),
      consultations: consultations
        .filter((consultation) => consultation.roleKey === roleKey)
        .map(({ consultation }) => consultation),
    };
  });
}

/** Each Consultation its Consultant answered themselves, in the order answered. */
function answeredConsultations(
  threads: readonly Thread[],
  decisions: readonly Decision[],
): readonly { readonly roleKey: string; readonly consultation: TabConsultation }[] {
  return threads
    .flatMap(({ id, roleKey, consultation }) => {
      const decision = decisions.find((candidate) => candidate.id === consultation?.decisionId);
      if (decision?.answer?.answeredBy !== roleKey) return [];
      const { answer } = decision;
      return [
        {
          roleKey,
          consultation: {
            threadId: id,
            decisionId: decision.id,
            question: decision.question,
            note: answerWords(decision, answer),
            answeredAt: answer.answeredAt,
          },
        },
      ];
    })
    .toSorted(
      (one, other) =>
        one.consultation.answeredAt.getTime() - other.consultation.answeredAt.getTime(),
    );
}
