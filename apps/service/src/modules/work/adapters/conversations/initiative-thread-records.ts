import { Injectable, type OnModuleInit } from "@nestjs/common";
import { ENDED_INITIATIVE_CONVERSATION_WORDS, OPEN_DECISION_TOOL } from "@the-office/contracts";
import {
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
import { PLANNER } from "../../domain/planning.js";
import { SHAPING_INSTRUCTIONS } from "../../domain/shaping.js";
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
  REMOVE_DEPENDENCY,
  WRITE_OUTCOME,
  WRITE_TASK_DESCRIPTION,
  WRITE_TASK_TITLE,
} from "../office-tools/shaping-office-tools.js";

/**
 * The Office tools of a shaping session: it reads every record and Attachment and changes its own
 * Initiative, straight while it is shaping and by Proposal once it is active; create_task is left
 * out, since a Task made there would be no part of it.
 */
export const SHAPING_OFFICE_TOOLS = [
  ...READING_OFFICE_TOOLS,
  WRITE_OUTCOME,
  ADD_TASK,
  ADD_DEPENDENCY,
  REMOVE_DEPENDENCY,
  WRITE_TASK_TITLE,
  WRITE_TASK_DESCRIPTION,
] as const;

/**
 * The Office tools of an Initiative's planning session: it reads every record and Attachment, moves
 * the Initiative's Tasks to Planning as their turn comes, writes each one's parts by its Task id,
 * and opens a Decision on a Task that needs the user's answer.
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
    const [initiative, record] = await Promise.all([
      this.initiatives.read(initiativeId),
      this.initiatives.recordText(initiativeId),
    ]);
    const sessionRefusal = ENDED_INITIATIVE_CONVERSATION_WORDS[initiative.state];
    if (roleKey !== PLANNER) {
      return {
        instructions: SHAPING_INSTRUCTIONS,
        officeTools: SHAPING_OFFICE_TOOLS,
        record,
        sessionRefusal,
      };
    }
    return {
      instructions: INITIATIVE_PLANNING_INSTRUCTIONS,
      officeTools: INITIATIVE_PLANNING_OFFICE_TOOLS,
      record: await this.planningBrief(initiative, record, threadId),
      sessionRefusal,
    };
  }

  private async planningBrief(
    initiative: Initiative,
    record: string,
    threadId: string,
  ): Promise<string> {
    const [byInitiative, pipelines, waiting] = await Promise.all([
      this.initiatives.tasksByInitiative(),
      this.pipelines.list(),
      this.decisions.openInThread(threadId),
    ]);
    const tasks = byInitiative.get(initiative.id) ?? [];
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
    const project = await this.projects.find(id);
    if (!project) return undefined;
    return {
      id,
      name: project.name,
      baseBranch: project.baseBranch,
      installCommand: project.installCommand,
      commands: project.commands,
    };
  }
}
