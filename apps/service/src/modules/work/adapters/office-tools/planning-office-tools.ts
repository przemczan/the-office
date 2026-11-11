import { Injectable, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { PlanningService, type MarkedPlanned } from "../../application/planning-service.js";
import { TaskService } from "../../application/task-service.js";
import { rewritingProblems } from "../../domain/initiative-planning.js";
import {
  SessionInitiatives,
  type SessionInitiativeThread,
} from "../../ports/session-initiatives.js";
import { SessionTasks } from "../../ports/session-tasks.js";
import { answered, WorkToolRefused, type OfficeToolResult } from "./work-tool-answers.js";

export const START_PLANNING = "start_planning";
export const WRITE_PLAN = "write_plan";
export const WRITE_DEFINITION_OF_DONE = "write_definition_of_done";
export const PROPOSE_PIPELINE = "propose_pipeline";
export const WRITE_TAGS = "write_tags";
export const MARK_PLANNED = "mark_planned";

const PROPOSED =
  "It shows on the Task as not confirmed until the user confirms it; end your turn when you want them to look at it.";

/** What a write does to a Ready Task, and which Tasks refuse it. */
const ON_A_READY_TASK = `Works while the Task is in Planning or Ready: a change to a Ready Task takes it back to Planning (and out of the queue), so write one only when the user asks, then call ${MARK_PLANNED} again. Refused once the Task has started, is Done or is Dropped.`;

const TASK_ID = z
  .string()
  .optional()
  .describe(
    "The Task's id. Leave it out in a Thread on the Task; in an Initiative's planning Thread, name one of its Tasks you moved to Planning with start_planning, or one already planned or Ready that you rewrite.",
  );

/**
 * The Office tools the Planner plans a Task with (spec §2.1, §2.3): in a Thread on the Task, each
 * writes onto the session's own Task, in Planning or Ready, which a change takes back to Planning;
 * in an Initiative's planning Thread, onto the Task it names,
 * one the Planner moved to Planning there with start_planning, or an already planned one it
 * rewrites, which goes back into Planning there. Each part is proposed for the user to confirm, but
 * for write_tags, whose Tags apply at once and never move a Task. The planning session reads with
 * `WorkOfficeTools` like every other.
 */

/** The Task a planning tool writes onto, and the planning Thread it is rewritten from, if it is. */
interface PlanningTarget {
  readonly taskId: string;
  readonly rewriteFrom: SessionInitiativeThread | undefined;
  /** In an Initiative's planning Thread, where the Planner plans on while a Decision waits. */
  readonly inInitiative: boolean;
}
@Injectable()
export class PlanningOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly planning: PlanningService,
    private readonly tasks: TaskService,
    private readonly sessionTasks: SessionTasks,
    private readonly sessionInitiatives: SessionInitiatives,
  ) {}

  onModuleInit(): void {
    this.registerStartPlanning();
    this.registerWritePlan();
    this.registerWriteDefinitionOfDone();
    this.registerProposePipeline();
    this.registerWriteTags();
    this.registerMarkPlanned();
  }

  private registerStartPlanning(): void {
    this.registry.register({
      name: START_PLANNING,
      description:
        "Moves one of this Initiative's Tasks from Backlog to Planning as its turn comes, so you can write its parts here by its Task id. Refused for a Task outside the Initiative or not in Backlog, and while a Task it waits for inside the Initiative is neither planned, Ready or beyond, nor Dropped. Works only in the Initiative's latest planning Thread.",
      input: z.object({
        taskId: z.string().describe("The Task's id, as your Brief lists it."),
      }),
      run: ({ taskId }, { sessionId }) =>
        answered(async () => {
          const thread = await this.sessionInitiatives.initiativeThreadInSession(sessionId);
          if (!thread) {
            throw new WorkToolRefused(
              "This tool works in an Initiative's planning Thread, and this session is in none.",
            );
          }
          const task = await this.planning.startPlanningInInitiative(thread, taskId);
          return `"${task.title}" is in Planning, planned in this Thread. Write its Plan, Definition of Done, Pipeline and Tags with its Task id, then call ${MARK_PLANNED} for it.`;
        }),
    });
  }

  private registerWritePlan(): void {
    this.registry.register({
      name: WRITE_PLAN,
      description: `Writes the Plan onto the Task: how it will be done, in plain words whoever implements it can follow, with the files it expects to change. It replaces the Plan the Task has; read the Task with read_task first, since the user may have edited it. Start warns the user when a Task in progress in the same Project expects to change some of the same files. ${PROPOSED} ${ON_A_READY_TASK}`,
      input: z.object({
        taskId: TASK_ID,
        plan: z.string().describe("The whole Plan, as Markdown."),
        filesToChange: z
          .array(z.string())
          .optional()
          .describe(
            "The files and folders the Plan expects to change, as paths from the repository's root; a folder covers everything under it. Left out, the Task keeps those it has.",
          ),
        estimatedTokens: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "The tokens (input, output and cache writes) you expect the whole Pipeline to use, every Stage together; shown with the Plan, and the Task's Usage estimate until the Office has done enough Tasks like it. Left out, the Task keeps the one it has.",
          ),
      }),
      run: ({ taskId, plan, filesToChange, estimatedTokens }, { sessionId }) =>
        answered(async () => {
          const target = await this.planningTaskOf(sessionId, taskId);
          await this.planning.proposePlan(
            target.taskId,
            { plan, filesToChange, estimatedTokens },
            target.rewriteFrom,
          );
          return `Wrote the Plan onto the Task. ${PROPOSED}`;
        }),
    });
  }

  private registerWriteDefinitionOfDone(): void {
    this.registry.register({
      name: WRITE_DEFINITION_OF_DONE,
      description: `Writes the Definition of Done onto the Task: what must be true when it is done, one plain-language statement each that can be checked. It replaces the Definition of Done the Task has; read the Task with read_task first, since the user may have edited it. ${PROPOSED} ${ON_A_READY_TASK}`,
      input: z.object({
        taskId: TASK_ID,
        statements: z
          .array(z.string())
          .describe("Every statement of the Definition of Done, one line each."),
      }),
      run: ({ taskId, statements }, { sessionId }) =>
        answered(async () => {
          const target = await this.planningTaskOf(sessionId, taskId);
          await this.planning.proposeDefinitionOfDone(
            target.taskId,
            statements,
            target.rewriteFrom,
          );
          return `Wrote the Definition of Done onto the Task. ${PROPOSED}`;
        }),
    });
  }

  private registerProposePipeline(): void {
    this.registry.register({
      name: PROPOSE_PIPELINE,
      description: `Proposes the Pipeline the Task's work follows, one of those your Brief lists, chosen from the Definition of Done. The Task keeps its Pipeline until the user confirms yours or chooses another. ${ON_A_READY_TASK}`,
      input: z.object({
        taskId: TASK_ID,
        pipelineId: z.string().describe("The Pipeline's id, as your Brief lists it."),
        why: z.string().describe("Why it fits the Definition of Done, in a sentence."),
      }),
      run: ({ taskId, pipelineId, why }, { sessionId }) =>
        answered(async () => {
          const target = await this.planningTaskOf(sessionId, taskId);
          await this.planning.proposePipeline(
            target.taskId,
            { pipelineId, reason: why },
            target.rewriteFrom,
          );
          return `Proposed the Pipeline ${pipelineId}. The Task follows it once the user confirms it.`;
        }),
    });
  }

  private registerWriteTags(): void {
    this.registry.register({
      name: WRITE_TAGS,
      description:
        "Sets the Task's Tags: a few short words the user finds Tasks by, such as its area or kind. It replaces the Tags the Task has; each is kept lower-case, spaces made hyphens. They apply at once, and the user can change them.",
      input: z.object({
        taskId: TASK_ID,
        tags: z.array(z.string()).describe("Every Tag the Task should have, one word each."),
      }),
      run: ({ taskId, tags }, { sessionId }) =>
        answered(async () => {
          const { taskId: target } = await this.planningTaskOf(sessionId, taskId);
          const task = await this.tasks.changeTags(target, tags);
          const inUse = (await this.tasks.tagsInUse()).filter((tag) => !task.tags.includes(tag));
          const now =
            task.tags.length > 0
              ? `The Task's Tags are now ${task.tags.join(", ")}.`
              : "The Task has no Tags now.";
          return inUse.length > 0 ? `${now} Other Tags in use: ${inUse.join(", ")}.` : now;
        }),
    });
  }

  private registerMarkPlanned(): void {
    this.registry.register({
      name: MARK_PLANNED,
      description:
        "Says the Task is planned: call it once the Plan, the Definition of Done and the Pipeline are written and nothing is left to ask the user. In auto mode, The Office then confirms them and marks the Task Ready; otherwise the user does. Refused outside Planning, or before the Plan and the Definition of Done are written; while a Decision on the Task is open it isn't marked planned.",
      input: z.object({ taskId: TASK_ID }),
      run: ({ taskId }, { sessionId }) =>
        answered(async () => {
          const target = await this.planningTaskOf(sessionId, taskId);
          const marked = await this.planning.markPlanned(target.taskId);
          return markedPlannedWords(marked, target.inInitiative);
        }),
    });
  }

  /**
   * The Task a planning tool writes onto: the session's own in a Thread on a Task, where `taskId`
   * may only name it; in an Initiative's planning Thread, the one `taskId` names, planned in that
   * Thread, or already planned and rewritten from it (`rewritingProblems`).
   */
  private async planningTaskOf(
    sessionId: string,
    taskId: string | undefined,
  ): Promise<PlanningTarget> {
    const ownTaskId = await this.sessionTasks.taskInSession(sessionId);
    if (ownTaskId !== undefined) {
      if (taskId !== undefined && taskId !== ownTaskId) {
        throw new WorkToolRefused(
          "This Thread is on one Task, and writes onto it alone: leave the Task id out.",
        );
      }
      return { taskId: ownTaskId, rewriteFrom: undefined, inInitiative: false };
    }
    const thread = await this.sessionInitiatives.initiativeThreadInSession(sessionId);
    if (!thread) {
      throw new WorkToolRefused(
        "This tool works in a Thread on a Task or in an Initiative's planning Thread, and this session is in neither.",
      );
    }
    if (taskId === undefined) {
      throw new WorkToolRefused(
        "Name the Task by its id: this Thread plans the Initiative's Tasks.",
      );
    }
    const task = await this.tasks.read(taskId);
    const plannedHere =
      task.initiativeId === thread.initiativeId &&
      task.state === "planning" &&
      task.initiativePlanningThreadId === thread.threadId;
    if (plannedHere) return { taskId: task.id, rewriteFrom: undefined, inInitiative: true };
    const problems = rewritingProblems(task, thread);
    if (problems.length > 0) throw new WorkToolRefused(problems.join(" "));
    return { taskId: task.id, rewriteFrom: thread, inInitiative: true };
  }
}

function markedPlannedWords(
  marked: MarkedPlanned,
  inInitiative: boolean,
): string | OfficeToolResult {
  switch (marked.outcome) {
    case "for-the-user":
      return "Marked the Task planned. Auto mode is off: the user confirms the Plan, the Definition of Done and the Pipeline, and marks the Task Ready.";
    case "waiting-for-a-decision": {
      const open =
        marked.openDecisions === 1
          ? "a Decision on it is"
          : `${marked.openDecisions} Decisions on it are`;
      const next = inInitiative
        ? `Keep planning the Tasks that don't wait for it, and end your turn once every Task left waits for an answer. The answer comes as a message: carry on from it, then call ${MARK_PLANNED} again.`
        : `End your turn; the user's answer comes as your next message. Carry on from it, then call ${MARK_PLANNED} again.`;
      return { text: `The Task isn't marked planned: ${open} still open. ${next}`, isError: true };
    }
    case "ready":
      return "Auto mode accepted the Task: it confirmed what wasn't confirmed yet and marked the Task Ready. Its planning is done.";
  }
}
