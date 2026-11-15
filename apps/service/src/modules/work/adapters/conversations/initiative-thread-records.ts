import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  ANSWER_DECISION_TOOL,
  CONSULT_TOOL,
  ENDED_INITIATIVE_CONVERSATION_WORDS,
  OPEN_DECISION_TOOL,
} from "@the-office/contracts";
import {
  CALLING_RULE,
  InitiativeThreadSetups,
  type InitiativeThreadRequest,
  type InitiativeThreadSetup,
  type InitiativeThreadSource,
  READING_OFFICE_TOOLS,
} from "../../../conversations/index.js";
import { InitiativeService } from "../../application/initiative-service.js";
import { initiativeProjectIds, type Initiative } from "../../domain/initiative.js";
import {
  INITIATIVE_PLANNING_INSTRUCTIONS,
  initiativePlanningBrief,
  type InitiativePlanningProject,
} from "../../domain/initiative-planning.js";
import { initiativeRecordText } from "../../domain/record-words.js";
import { SHAPING_INSTRUCTIONS, shapingBrief, type ShapingProject } from "../../domain/shaping.js";
import type { Task } from "../../domain/task.js";
import { KnownPipelines } from "../../ports/known-pipelines.js";
import { KnownProjects } from "../../ports/known-projects.js";
import { TaskDecisions } from "../../ports/task-decisions.js";
import { WRITE_COMMIT_MESSAGE } from "../office-tools/commit-message-office-tools.js";
import {
  MARK_PLANNED,
  PROPOSE_PIPELINE,
  START_PLANNING,
  WRITE_DEFINITION_OF_DONE,
  WRITE_PLAN,
  WRITE_TAGS,
} from "../office-tools/planning-office-tools.js";
import {
  ADD_TASK,
  CHOOSE_PIPELINE,
  WRITE_OUTCOME,
  WRITE_TASK_DESCRIPTION,
  WRITE_TASK_TITLE,
} from "../office-tools/shaping-office-tools.js";
import { initiativeBranchReads } from "./initiative-branch-reads.js";

/**
 * The Office tools of a shaping session: it reads every record and Attachment and changes its own
 * Initiative, straight while it is shaping and by Proposal once it is active; create_task is left
 * out, since a Task made there would be no part of it. Its Tasks' dependencies and which Tasks it
 * has are Office actions, which the session gets by its person's duties (spec 5.4). It answers a
 * Decision for the user when they ask, as every Thread the user talks in does, and calls a person
 * when the user asks (`CALLING_RULE`), on no Task, as a chat calls.
 */
export const SHAPING_OFFICE_TOOLS = [
  ...READING_OFFICE_TOOLS,
  WRITE_OUTCOME,
  ADD_TASK,
  WRITE_TASK_TITLE,
  WRITE_TASK_DESCRIPTION,
  CHOOSE_PIPELINE,
  ANSWER_DECISION_TOOL,
  CONSULT_TOOL,
] as const;

/** A shaping Thread's instructions, ending with when it calls a person. */
export const SHAPING_THREAD_INSTRUCTIONS = `${SHAPING_INSTRUCTIONS}\n\n${CALLING_RULE}`;

/** An Initiative's planning Thread's instructions, ending with when it calls a person. */
export const INITIATIVE_PLANNING_THREAD_INSTRUCTIONS = `${INITIATIVE_PLANNING_INSTRUCTIONS}\n\n${CALLING_RULE}`;

/**
 * The Office tools of an Initiative's planning session: it reads every record and Attachment, moves
 * the Initiative's Tasks to Planning as their turn comes, writes each one's parts by its Task id,
 * opens a Decision on a Task that needs the user's answer, and answers one for the user when they
 * ask; it calls a person when the user asks, on the Task its call names, or on none.
 */
export const INITIATIVE_PLANNING_OFFICE_TOOLS = [
  ...READING_OFFICE_TOOLS,
  OPEN_DECISION_TOOL,
  START_PLANNING,
  WRITE_PLAN,
  WRITE_DEFINITION_OF_DONE,
  PROPOSE_PIPELINE,
  WRITE_TAGS,
  WRITE_COMMIT_MESSAGE,
  MARK_PLANNED,
  ANSWER_DECISION_TOOL,
  CONSULT_TOOL,
] as const;

/**
 * Sets up the sessions of Threads on Initiatives for Conversations, from the Initiative's record:
 * the Threads Plan the Initiative opened plan its Tasks, every other one shapes it. Told apart by
 * the Initiative's own list of them, never by the person, so a planning Thread stays one when
 * Plans moves, and one Role holding both Shapes Initiatives and Plans has both kinds.
 */
@Injectable()
export class InitiativeThreadRecords implements InitiativeThreadSource, OnModuleInit {
  constructor(
    private readonly setups: InitiativeThreadSetups,
    private readonly initiatives: InitiativeService,
    private readonly projects: KnownProjects,
    private readonly pipelines: KnownPipelines,
    private readonly decisions: TaskDecisions,
  ) {}

  onModuleInit(): void {
    this.setups.provide(this);
  }

  async setUp({ threadId, initiativeId }: InitiativeThreadRequest): Promise<InitiativeThreadSetup> {
    const initiativeRecord = await this.initiatives.record(initiativeId);
    const { initiative, idea, tasks } = initiativeRecord;
    const record = initiativeRecordText(initiativeRecord);
    const sessionRefusal = ENDED_INITIATIVE_CONVERSATION_WORDS[initiative.state];
    const branchReads = initiativeBranchReads(initiative, tasks);
    if (!initiative.planningThreadIds.includes(threadId)) {
      return {
        instructions: SHAPING_THREAD_INSTRUCTIONS,
        officeTools: SHAPING_OFFICE_TOOLS,
        record: await this.shapingBrief(initiative, idea?.projectId, record, tasks),
        sessionRefusal,
        branchReads,
      };
    }
    return {
      instructions: INITIATIVE_PLANNING_THREAD_INSTRUCTIONS,
      officeTools: INITIATIVE_PLANNING_OFFICE_TOOLS,
      record: await this.planningBrief(initiative, record, tasks, threadId),
      sessionRefusal,
      branchReads,
    };
  }

  private async shapingBrief(
    initiative: Initiative,
    ideaProjectId: string | undefined,
    record: string,
    tasks: readonly Task[],
  ): Promise<string> {
    const [officeWide, projects] = await Promise.all([
      this.pipelines.list(),
      Promise.all(initiativeProjectIds(tasks).map((id) => this.shapingProject(id))),
    ]);
    return shapingBrief(initiative, ideaProjectId, record, projects, officeWide);
  }

  private async shapingProject(id: string): Promise<ShapingProject> {
    const [project, pipelines] = await Promise.all([
      this.projects.find(id),
      this.pipelines.listFor(id),
    ]);
    return {
      id,
      name: project?.name ?? id,
      ownPipelines: pipelines.filter(({ projectId }) => projectId === id),
    };
  }

  private async planningBrief(
    initiative: Initiative,
    record: string,
    tasks: readonly Task[],
    threadId: string,
  ): Promise<string> {
    const [pipelines, waiting] = await Promise.all([
      this.pipelines.list(),
      this.decisions.openInThread(threadId),
    ]);
    const projects = await Promise.all(
      initiativeProjectIds(tasks).map((id) => this.planningProject(id)),
    );
    return initiativePlanningBrief({
      initiative,
      waiting,
      record,
      tasks,
      projects: projects.filter((project) => project !== undefined),
      pipelines,
    });
  }

  private async planningProject(id: string): Promise<InitiativePlanningProject | undefined> {
    const [project, pipelines] = await Promise.all([
      this.projects.find(id),
      this.pipelines.listFor(id),
    ]);
    if (!project) return undefined;
    return {
      id,
      ownPipelines: pipelines.filter(({ projectId }) => projectId === id),
      name: project.name,
      baseBranch: project.baseBranch,
      defaultPipeline: project.defaultPipeline,
      installCommand: project.installCommand,
      commands: project.commands,
    };
  }
}
