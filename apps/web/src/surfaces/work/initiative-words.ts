import type { Initiative, InitiativeState, Task } from "@the-office/contracts";
import type { BadgeProps } from "@the-office/ui";
import { NOT_STARTED } from "../../shell/work/work-words.ts";
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

/**
 * Whether the Task is an Initiative's Publishing Task (spec 2.1): The Office adds one per Project
 * once the other Tasks have ended, and it publishes the Initiative's branch into the base branch.
 */
export function isPublishingTask({ madeFor }: Pick<Task, "madeFor">): boolean {
  return madeFor === "publishing";
}

/** The Initiative's Tasks but its Publishing Tasks, which the Pipeline block lists apart. */
export function ordinaryTasksOf(initiative: Initiative, tasks: readonly Task[]): Task[] {
  return tasksOfInitiative(initiative, tasks).filter((task) => !isPublishingTask(task));
}

/** The Initiative's Publishing Tasks, in the order they were added. */
export function publishingTasksOf(initiative: Initiative, tasks: readonly Task[]): Task[] {
  return tasksOfInitiative(initiative, tasks).filter(isPublishingTask);
}

const STARTED: readonly Task["state"][] = ["in-progress", "waiting-on-you", "paused"];

/**
 * Why a started Publishing Task waits before its next Stage: a Task added to its Initiative or
 * moved into its Project that isn't Done or Dropped yet. Undefined when nothing holds it back.
 */
export function publishingWaitWords(task: Task, tasks: readonly Task[]): string | undefined {
  if (!isPublishingTask(task) || !STARTED.includes(task.state)) return undefined;
  const blockers = blockingTasksOf(task, tasks);
  if (blockers.length === 0) return undefined;
  const titles = blockers.map(({ title }) => `“${title}”`).join(", ");
  return `Waits for ${titles} before its next Stage.`;
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

/** What an Initiative's Drop takes with it (spec 2.1): every Task not yet Done or Dropped. */
export interface DroppedWithIt {
  readonly open: number;
  /** Those of them started, whose running Stage stops. */
  readonly started: number;
}

export function droppedWithIt(initiativeTasks: readonly Task[]): DroppedWithIt {
  const open = initiativeTasks.filter(({ state }) => state !== "done" && state !== "dropped");
  const started = open.filter(({ state }) => !NOT_STARTED.includes(state));
  return { open: open.length, started: started.length };
}

/** The Drop dialog's line on the Tasks it drops. */
export function dropTasksWords({ open, started }: DroppedWithIt): string {
  if (open === 0) return "Its Tasks are all Done or Dropped already, so it drops none.";
  const tasks = open === 1 ? "its 1 Task" : `its ${open} Tasks`;
  return `It drops ${tasks} not yet Done or Dropped, ${startedWords(open, started)}.`;
}

function startedWords(open: number, started: number): string {
  if (open === 1) return started === 1 ? "which has started: its Stage stops" : "not started yet";
  if (started === 0) return "none of them started";
  return `${started} of them started: ${started === 1 ? "its Stage stops" : "their Stages stop"}`;
}

/** What Drop did. */
export function droppedWords({ open }: Pick<DroppedWithIt, "open">): string {
  if (open === 0) return "Initiative dropped.";
  return `Initiative dropped, with its ${open === 1 ? "1 open Task" : `${open} open Tasks`}.`;
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
