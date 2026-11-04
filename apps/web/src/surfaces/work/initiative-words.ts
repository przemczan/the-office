import type { Initiative, InitiativeState, Task } from "@the-office/contracts";
import type { BadgeProps } from "@the-office/ui";
import { blockersOf, blockingTasksOf } from "./dependency-words.ts";
import { firstLine, withoutMarkdownMarks } from "./stage-words.ts";

export const INITIATIVE_STATE_TONES: Readonly<
  Record<InitiativeState, NonNullable<BadgeProps["tone"]>>
> = {
  shaping: "warning",
  active: "info",
  done: "success",
  dropped: "danger",
};

/** The state as its badge says it; shaping names the CTO it is shaped with, when one is hired. */
export function initiativeStateName(state: InitiativeState, ctoName: string | undefined): string {
  switch (state) {
    case "shaping":
      return ctoName === undefined ? "Shaping" : `Shaping with ${ctoName}`;
    case "active":
      return "Active";
    case "done":
      return "Done";
    case "dropped":
      return "Dropped";
  }
}

/** The Initiative's Tasks, in the board's order. */
export function tasksOfInitiative(initiative: Initiative, tasks: readonly Task[]): Task[] {
  return tasks.filter(({ initiativeId }) => initiativeId === initiative.id);
}

/** How far the Initiative is; a Dropped Task no longer counts, as it is done without it (spec §2.1). */
export interface InitiativeProgress {
  readonly done: number;
  readonly counted: number;
  /** Ready, and waiting for no Task. */
  readonly readyToStart: number;
}

export function initiativeProgress(
  initiativeTasks: readonly Task[],
  tasks: readonly Task[],
): InitiativeProgress {
  const counted = initiativeTasks.filter(({ state }) => state !== "dropped");
  return {
    done: counted.filter(({ state }) => state === "done").length,
    counted: counted.length,
    readyToStart: counted.filter(
      (task) => task.state === "ready" && blockingTasksOf(task, tasks).length === 0,
    ).length,
  };
}

export function progressWords({ done, counted, readyToStart }: InitiativeProgress): string {
  const ready = readyToStart > 0 ? ` · ${readyToStart} ready to start` : "";
  return `${done} of ${counted} ${counted === 1 ? "Task" : "Tasks"} done${ready}`;
}

/** The Outcome block's folded line. */
export function outcomeSummary(outcome: string): string {
  return outcome === "" ? "Not written yet" : withoutMarkdownMarks(firstLine(outcome));
}

/** The Attachments block's folded line. */
export function attachmentsSummary(count: number): string {
  if (count === 0) return "None";
  return `${count} ${count === 1 ? "Attachment" : "Attachments"}`;
}

/** A Task in the graph; a blocker from outside the Initiative is drawn too, marked. */
export interface GraphNode {
  readonly task: Task;
  readonly outside: boolean;
}

/** "Must be Done first": an arrow from the blocker to the Task waiting for it. */
export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly blockerDone: boolean;
}

export interface TaskGraph {
  /** A column per dependency depth: a Task stands right of every Task it waits for. */
  readonly columns: readonly (readonly GraphNode[])[];
  readonly edges: readonly GraphEdge[];
}

/**
 * The Initiative's Tasks and the blockers they wait for from outside it, laid out by depth over
 * the edges among them only, so an outside blocker's own blockers add no empty columns.
 */
export function taskGraph(initiativeTasks: readonly Task[], tasks: readonly Task[]): TaskGraph {
  const inside = new Set(initiativeTasks.map(({ id }) => id));
  const outsideBlockers = uniqueById(
    initiativeTasks.flatMap((task) => blockersOf(task, tasks)).filter(({ id }) => !inside.has(id)),
  );
  const nodes: GraphNode[] = [
    ...outsideBlockers.map((task) => ({ task, outside: true })),
    ...initiativeTasks.map((task) => ({ task, outside: false })),
  ];
  const byId = new Map(nodes.map((node) => [node.task.id, node]));
  const edges = initiativeTasks.flatMap((task) =>
    task.blockedBy.flatMap((blockerId) => {
      const blocker = byId.get(blockerId)?.task;
      return blocker
        ? [{ from: blocker.id, to: task.id, blockerDone: blocker.state === "done" }]
        : [];
    }),
  );
  const depths = depthsOf(nodes, edges);
  const columns: GraphNode[][] = [];
  for (const node of nodes) {
    const depth = depths.get(node.task.id) ?? 0;
    (columns[depth] ??= []).push(node);
  }
  return {
    columns: columns.map((column) =>
      column.toSorted((first, second) => first.task.projectId.localeCompare(second.task.projectId)),
    ),
    edges,
  };
}

function depthsOf(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): Map<string, number> {
  const blockersById = new Map<string, string[]>();
  for (const { from, to } of edges) blockersById.set(to, [...(blockersById.get(to) ?? []), from]);
  const depths = new Map<string, number>();
  const depthOf = (id: string): number => {
    const known = depths.get(id);
    if (known !== undefined) return known;
    // Seeded first, so a cycle the service should never allow still ends.
    depths.set(id, 0);
    const blockers = blockersById.get(id) ?? [];
    const depth = blockers.length === 0 ? 0 : 1 + Math.max(...blockers.map(depthOf));
    depths.set(id, depth);
    return depth;
  };
  for (const { task } of nodes) depthOf(task.id);
  return depths;
}

function uniqueById(tasks: readonly Task[]): Task[] {
  return [...new Map(tasks.map((task) => [task.id, task])).values()];
}
