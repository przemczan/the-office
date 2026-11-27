import type {
  Initiative,
  LiveAgent,
  LiveView,
  RunningTask,
  TaskMadeFor,
  TaskSummary,
} from "@the-office/contracts";

/** Where a row's title opens: the Thread the Agent answers in. */
export type WorkingAgentTarget =
  | { readonly kind: "task"; readonly taskId: string; readonly threadId: string }
  | { readonly kind: "initiative"; readonly initiativeId: string; readonly threadId: string }
  | { readonly kind: "chat"; readonly roleKey: string; readonly threadId: string };

/** One Agent session answering now, worded for Now's Agents section. */
export interface WorkingAgent {
  readonly threadId: string;
  readonly roleKey: string;
  readonly personName: string;
  /** What kind of work it is: the Stage's name, Planning, Shaping, Consultation, Chat or Thread. */
  readonly badge: string;
  /** The Task's title, the Initiative's name, or who a Consultation is for. */
  readonly title: string;
  readonly target: WorkingAgentTarget;
  /** The Task's `madeFor`, for the Off-board Task badge; null for any other work. */
  readonly madeFor: TaskMadeFor | null;
  /** The Projects of its Task or Initiative; none for a chat and for an Initiative with no Tasks. */
  readonly projectIds: readonly string[];
  /** "on Personal", plus ", standing in for Work" on a Stand-in Engine; null before it opens. */
  readonly engineWords: string | null;
  /** When the running turn began; null for one already running before it was kept. */
  readonly since: string | null;
}

/** What Now already holds to word an Agent's work. */
export interface WorkingAgentRecords {
  readonly tasks: readonly TaskSummary[];
  readonly initiatives: readonly Initiative[];
  readonly running: readonly RunningTask[];
}

/** Every Agent answering now, the longest-working first; one with no known start comes last. */
export function workingAgentsOf(
  snapshot: LiveView,
  records: WorkingAgentRecords,
): readonly WorkingAgent[] {
  const names = new Map(snapshot.people.map((person) => [person.roleKey, person.name]));
  return snapshot.people
    .flatMap((person) =>
      person.agents.map((agent) => workingAgentOf(person, agent, records, names)),
    )
    .toSorted((one, other) => sinceOrder(one.since) - sinceOrder(other.since));
}

function sinceOrder(since: string | null): number {
  return since === null ? Number.POSITIVE_INFINITY : Date.parse(since);
}

function workingAgentOf(
  person: LiveView["people"][number],
  agent: LiveAgent,
  { tasks, initiatives, running }: WorkingAgentRecords,
  names: ReadonlyMap<string, string>,
): WorkingAgent {
  const { home } = agent;
  const task = home.kind === "task" ? tasks.find(({ id }) => id === home.taskId) : undefined;
  const initiative =
    home.kind === "initiative" ? initiatives.find(({ id }) => id === home.initiativeId) : undefined;
  const stage =
    home.kind === "task" ? running.find(({ taskId }) => taskId === home.taskId)?.stage : undefined;
  const common = {
    threadId: agent.threadId,
    roleKey: person.roleKey,
    personName: person.name,
    madeFor: task?.madeFor ?? null,
    projectIds: task ? [task.projectId] : (initiative?.projectIds ?? []),
    engineWords: engineWordsOf(agent),
    since: agent.since,
  };
  const target = targetOf(agent);
  if (agent.kind === "consultation") {
    const asker = agent.consultation?.askerRoleKey ?? null;
    return {
      ...common,
      target,
      badge: "Consultation",
      title: `for ${asker === null ? "The Office" : (names.get(asker) ?? "a colleague")}`,
    };
  }
  switch (home.kind) {
    case "task":
      return {
        ...common,
        target,
        badge:
          agent.kind === "stage"
            ? (stage?.name ?? "Stage")
            : task?.state === "planning"
              ? "Planning"
              : "Thread",
        title: task?.title ?? "a Task",
      };
    case "initiative":
      return {
        ...common,
        target,
        badge: initiative?.state === "shaping" ? "Shaping" : "Planning",
        title: initiative?.name ?? "an Initiative",
      };
    case "chat":
      return { ...common, target, badge: "Chat", title: "with you" };
  }
}

function targetOf({ home, threadId }: LiveAgent): WorkingAgentTarget {
  switch (home.kind) {
    case "task":
      return { kind: "task", taskId: home.taskId, threadId };
    case "initiative":
      return { kind: "initiative", initiativeId: home.initiativeId, threadId };
    case "chat":
      return { kind: "chat", roleKey: home.roleKey, threadId };
  }
}

function engineWordsOf({ engine }: LiveAgent): string | null {
  if (engine === null) return null;
  const standingIn = engine.standInFor ? `, standing in for ${engine.standInFor.engineName}` : "";
  return `on ${engine.engineName}${standingIn}`;
}
