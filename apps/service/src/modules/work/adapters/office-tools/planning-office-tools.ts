import { Injectable, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { PlanningService, type MarkedPlanned } from "../../application/planning-service.js";
import { TaskService } from "../../application/task-service.js";
import { TASK_STATE_NAMES } from "../../domain/task-states.js";
import { SessionInitiatives } from "../../ports/session-initiatives.js";
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

const TASK_ID = z
  .string()
  .optional()
  .describe(
    "The Task's id. Leave it out in a Thread on the Task; in an Initiative's planning Thread, name one of its Tasks you moved to Planning with start_planning.",
  );

/**
 * The Office tools the Planner plans a Task with (spec §2.1, §2.3): in a Thread on the Task, each
 * writes onto the session's own Task; in an Initiative's planning Thread, onto the Task it names,
 * one the Planner moved to Planning there with start_planning. Each part is proposed for the user
 * to confirm, but for write_tags, whose Tags apply at once. The planning session reads with
 * `WorkOfficeTools` like every other.
 */
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
      description: `Writes the Plan onto the Task: how it will be done, in plain words whoever implements it can follow, with the files it expects to change. It replaces the Plan the Task has; read the Task with read_task first, since the user may have edited it. Start warns the user when a Task in progress in the same Project expects to change some of the same files. ${PROPOSED}`,
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
          await this.planning.proposePlan(await this.planningTaskOf(sessionId, taskId), {
            plan,
            filesToChange,
            estimatedTokens,
          });
          return `Wrote the Plan onto the Task. ${PROPOSED}`;
        }),
    });
  }

  private registerWriteDefinitionOfDone(): void {
    this.registry.register({
      name: WRITE_DEFINITION_OF_DONE,
      description: `Writes the Definition of Done onto the Task: what must be true when it is done, one plain-language statement each that can be checked. It replaces the Definition of Done the Task has; read the Task with read_task first, since the user may have edited it. ${PROPOSED}`,
      input: z.object({
        taskId: TASK_ID,
        statements: z
          .array(z.string())
          .describe("Every statement of the Definition of Done, one line each."),
      }),
      run: ({ taskId, statements }, { sessionId }) =>
        answered(async () => {
          await this.planning.proposeDefinitionOfDone(
            await this.planningTaskOf(sessionId, taskId),
            statements,
          );
          return `Wrote the Definition of Done onto the Task. ${PROPOSED}`;
        }),
    });
  }

  private registerProposePipeline(): void {
    this.registry.register({
      name: PROPOSE_PIPELINE,
      description:
        "Proposes the Pipeline the Task's work follows, one of those your Brief lists, chosen from the Definition of Done. The Task keeps its Pipeline until the user confirms yours or chooses another.",
      input: z.object({
        taskId: TASK_ID,
        pipelineId: z.string().describe("The Pipeline's id, as your Brief lists it."),
        why: z.string().describe("Why it fits the Definition of Done, in a sentence."),
      }),
      run: ({ taskId, pipelineId, why }, { sessionId }) =>
        answered(async () => {
          await this.planning.proposePipeline(await this.planningTaskOf(sessionId, taskId), {
            pipelineId,
            reason: why,
          });
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
          const task = await this.tasks.changeTags(
            await this.planningTaskOf(sessionId, taskId),
            tags,
          );
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
        "Says the Task is planned: call it once the Plan, the Definition of Done and the Pipeline are written and nothing is left to ask the user. In auto mode, The Office then confirms them and marks the Task Ready; otherwise the user does. Refused outside Planning, or before the Plan and the Definition of Done are written.",
      input: z.object({ taskId: TASK_ID }),
      run: ({ taskId }, { sessionId }) =>
        answered(async () => {
          const marked = await this.planning.markPlanned(
            await this.planningTaskOf(sessionId, taskId),
          );
          return markedPlannedWords(marked);
        }),
    });
  }

  /**
   * The Task a planning tool writes onto: the session's own in a Thread on a Task, where `taskId`
   * may only name it; in an Initiative's planning Thread, the one `taskId` names, which must be
   * planned in that Thread.
   */
  private async planningTaskOf(sessionId: string, taskId: string | undefined): Promise<string> {
    const ownTaskId = await this.sessionTasks.taskInSession(sessionId);
    if (ownTaskId !== undefined) {
      if (taskId !== undefined && taskId !== ownTaskId) {
        throw new WorkToolRefused(
          "This Thread is on one Task, and writes onto it alone: leave the Task id out.",
        );
      }
      return ownTaskId;
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
    if (task.initiativeId !== thread.initiativeId) {
      throw new WorkToolRefused(`"${task.title}" isn't one of this Initiative's Tasks.`);
    }
    if (task.state !== "planning" || task.initiativePlanningThreadId !== thread.threadId) {
      throw new WorkToolRefused(
        task.state === "backlog"
          ? `"${task.title}" is in Backlog: move it to Planning with ${START_PLANNING} first.`
          : `"${task.title}" isn't being planned in this Thread; it is in ${TASK_STATE_NAMES[task.state]}.`,
      );
    }
    return task.id;
  }
}

function markedPlannedWords(marked: MarkedPlanned): string | OfficeToolResult {
  switch (marked.outcome) {
    case "for-the-user":
      return "Marked the Task planned. Auto mode is off: the user confirms the Plan, the Definition of Done and the Pipeline, and marks the Task Ready.";
    case "waiting-for-a-decision":
      return {
        text: `The Task isn't marked planned: ${marked.openDecisions === 1 ? "a Decision on it is" : `${marked.openDecisions} Decisions on it are`} still open. End your turn; the user's answer comes as your next message. Carry on from it, then call ${MARK_PLANNED} again.`,
        isError: true,
      };
    case "ready":
      return "Auto mode accepted the Task: it confirmed what wasn't confirmed yet and marked the Task Ready. Its planning is done.";
  }
}
