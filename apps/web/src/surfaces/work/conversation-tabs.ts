import type { ConversationTab, Decision, TaskStage, Thread } from "@the-office/contracts";

/**
 * The person's tab the address names, by their key or by any of their Threads. A Stage's Thread
 * leads here only beside a Decision: alone, the Stage history takes it (`useStageHistory`).
 */
export function tabAsked(
  taskThread: string | undefined,
  tabs: readonly ConversationTab[],
  threads: readonly Thread[],
): string | undefined {
  if (taskThread === undefined) return undefined;
  const roleKey = threads.find(({ id }) => id === taskThread)?.roleKey ?? taskThread;
  return tabs.find((tab) => tab.roleKey === roleKey)?.roleKey;
}

/** The one whose Thread holds an open Decision, else the person whose Stage runs, else the Planner. */
export function firstTab(
  tabs: readonly ConversationTab[],
  openDecisions: readonly Pick<Decision, "threadId">[],
): string | undefined {
  const holdingDecision = tabs.find(({ threadId }) =>
    openDecisions.some((decision) => decision.threadId === threadId),
  );
  return (holdingDecision ?? tabs.find(({ stageRunning }) => stageRunning) ?? tabs[0])?.roleKey;
}

/** The Stages the person ran on the Task, in Pipeline order. */
export function stagesWorkedOn(
  stages: readonly TaskStage[],
  threads: readonly Thread[],
  roleKey: string,
): string[] {
  const own = stageThreadsOf(threads, roleKey);
  return stages
    .filter(({ runs }) => runs.some(({ threadId }) => threadId !== null && own.has(threadId)))
    .map(({ stage }) => stage.name);
}

/** The Stage the person is working on now, whose run goes on in one of their Stage Threads. */
export function stageRunningFor(
  stages: readonly TaskStage[],
  threads: readonly Thread[],
  roleKey: string,
): TaskStage | undefined {
  const own = stageThreadsOf(threads, roleKey);
  return stages.find(({ runs }) =>
    runs.some(
      ({ threadId, endedAt }) => endedAt === null && threadId !== null && own.has(threadId),
    ),
  );
}

function stageThreadsOf(threads: readonly Thread[], roleKey: string): ReadonlySet<string> {
  return new Set(
    threads
      .filter((thread) => thread.roleKey === roleKey && thread.stageThread)
      .map(({ id }) => id),
  );
}

/** Under the person's name: what they did on the Task. */
export function tabLine(
  isPlanner: boolean,
  tab: ConversationTab,
  workedOn: readonly string[],
): string {
  if (isPlanner && tab.planningThreadElsewhere !== null) {
    return "Plans this Task in the Initiative's planning Thread";
  }
  if (isPlanner) return tab.threadId === null ? "Hasn't planned this Task" : "Plans this Task";
  if (workedOn.length > 0) return `Worked on ${workedOn.join(" · ")}`;
  if (tab.consultations.some(({ answeredAt }) => answeredAt === null)) {
    return "In a Consultation on this Task";
  }
  return tab.consultations.length > 0 ? "Answered a Consultation on this Task" : "";
}

/** What a person's tab says before anything is written in their Thread. */
export function emptyThreadWords(
  isPlanner: boolean,
  personName: string,
  workedOn: readonly string[],
): string {
  const ask = `Ask ${personName} anything about this Task`;
  if (isPlanner) return `No conversation yet. ${ask}.`;
  return workedOn.length > 0
    ? `No messages yet. ${ask}: ${personName} worked on ${workedOn.join(" and ")}.`
    : `No messages yet. ${ask}.`;
}

/**
 * The Planner's tab while the Task is planned in its Initiative's planning Thread (Plan the
 * Initiative), which counts as its planning Thread: nothing is written here meanwhile.
 */
export function plannedElsewhereWords(personName: string): string {
  return `${personName} is planning this Task in the Initiative's planning Thread.`;
}
