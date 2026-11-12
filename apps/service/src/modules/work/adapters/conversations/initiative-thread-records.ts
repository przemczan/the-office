import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  ANSWER_DECISION_TOOL,
  ENDED_INITIATIVE_CONVERSATION_WORDS,
  OPEN_DECISION_TOOL,
} from "@the-office/contracts";
import {
  InitiativeThreadSetups,
  type InitiativeBranchReads,
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
import { PLANNER } from "../../domain/planning.js";
import { initiativeRecordText } from "../../domain/record-words.js";
import { SHAPING_INSTRUCTIONS, shapingBrief } from "../../domain/shaping.js";
import { initiativeBranchOf } from "../../domain/short-name.js";
import type { Task } from "../../domain/task.js";
import { KnownPipelines } from "../../ports/known-pipelines.js";
import { KnownProjects } from "../../ports/known-projects.js";
import { TaskDecisions } from "../../ports/task-decisions.js";
import {
  MARK_PLANNED,
  PROPOSE_PIPELINE,
  START_PLANNING,
  WRITE_DEFINITION_OF_DONE,
  WRITE_PLAN,
  WRITE_TAGS,
} from "../office-tools/planning-office-tools.js";
import {
  ADD_DEPENDENCY,
  ADD_TASK,
  CHOOSE_PIPELINE,
  REMOVE_DEPENDENCY,
  WRITE_OUTCOME,
  WRITE_TASK_DESCRIPTION,
  WRITE_TASK_TITLE,
} from "../office-tools/shaping-office-tools.js";

/**
 * The Office tools of a shaping session: it reads every record and Attachment and changes its own
 * Initiative, straight while it is shaping and by Proposal once it is active; create_task is left
 * out, since a Task made there would be no part of it. It answers a Decision for the user when they
 * ask, as every Thread the user talks in does.
 */
export const SHAPING_OFFICE_TOOLS = [
  ...READING_OFFICE_TOOLS,
  WRITE_OUTCOME,
  ADD_TASK,
  ADD_DEPENDENCY,
  REMOVE_DEPENDENCY,
  WRITE_TASK_TITLE,
  WRITE_TASK_DESCRIPTION,
  CHOOSE_PIPELINE,
  ANSWER_DECISION_TOOL,
] as const;

/**
 * The Office tools of an Initiative's planning session: it reads every record and Attachment, moves
 * the Initiative's Tasks to Planning as their turn comes, writes each one's parts by its Task id,
 * opens a Decision on a Task that needs the user's answer, and answers one for the user when they
 * ask.
 */
export const INITIATIVE_PLANNING_OFFICE_TOOLS = [
  ...READING_OFFICE_TOOLS,
  OPEN_DECISION_TOOL,
  START_PLANNING,
  WRITE_PLAN,
  WRITE_DEFINITION_OF_DONE,
  PROPOSE_PIPELINE,
  WRITE_TAGS,
  MARK_PLANNED,
  ANSWER_DECISION_TOOL,
] as const;

/**
 * Sets up the sessions of Threads on Initiatives for Conversations, from the Initiative's record:
 * the Planner's Threads plan its Tasks (Plan the Initiative), every other one shapes it with the
 * CTO. Told apart by the person, so an earlier planning Thread stays a planning one.
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

  async setUp({
    threadId,
    initiativeId,
    roleKey,
  }: InitiativeThreadRequest): Promise<InitiativeThreadSetup> {
    const initiativeRecord = await this.initiatives.record(initiativeId);
    const { initiative, idea, tasks } = initiativeRecord;
    const record = initiativeRecordText(initiativeRecord);
    const sessionRefusal = ENDED_INITIATIVE_CONVERSATION_WORDS[initiative.state];
    const branchReads = initiativeBranchReads(initiative, tasks);
    if (roleKey !== PLANNER) {
      return {
        instructions: SHAPING_INSTRUCTIONS,
        officeTools: SHAPING_OFFICE_TOOLS,
        record: shapingBrief(initiative, idea.projectId, record, await this.pipelines.list()),
        sessionRefusal,
        branchReads,
      };
    }
    return {
      instructions: INITIATIVE_PLANNING_INSTRUCTIONS,
      officeTools: INITIATIVE_PLANNING_OFFICE_TOOLS,
      record: await this.planningBrief(initiative, record, tasks, threadId),
      sessionRefusal,
      branchReads,
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

/**
 * The Projects an active Initiative with a Pipeline is read at its branch in (spec §2.4): those it
 * spans now that it has its branch in; one it stopped spanning is read at its base. Undefined while
 * it is shaping, on None, or confirmed before Initiatives had a Pipeline, so it reads base branches.
 */
function initiativeBranchReads(
  initiative: Initiative,
  tasks: readonly Task[],
): InitiativeBranchReads | undefined {
  const { state, pipelineId, shortName, branches } = initiative;
  if (state !== "active" || pipelineId === undefined || shortName === undefined) return undefined;
  const branched = new Set(branches.map(({ projectId }) => projectId));
  return {
    shortName,
    branch: initiativeBranchOf(shortName),
    projectIds: initiativeProjectIds(tasks).filter((projectId) => branched.has(projectId)),
  };
}
