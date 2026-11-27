import { Injectable, type OnModuleInit } from "@nestjs/common";
import { readEach } from "../../../../platform/database/fan-out.js";
import {
  ANSWER_DECISION_TOOL,
  CONSULT_TOOL,
  ENDED_INITIATIVE_CONVERSATION_WORDS,
  OPEN_DECISION_TOOL,
} from "@the-office/contracts";
import {
  InitiativeThreadSetups,
  type InitiativeThreadRequest,
  type InitiativeThreadSetup,
  type InitiativeThreadSource,
  READING_OFFICE_TOOLS,
} from "../../../conversations/index.js";
import { PromptTemplates, type PromptTexts } from "../../../prompt-templates/index.js";
import { InitiativeService } from "../../application/initiative-service.js";
import {
  initiativeProjectIds,
  planningThreadOf,
  type Initiative,
} from "../../domain/initiative.js";
import {
  initiativePlanningBrief,
  initiativePlanningInstructions,
  type InitiativePlanningProject,
} from "../../domain/initiative-planning.js";
import { initiativeRecordText } from "../../domain/record-words.js";
import {
  shapingBrief,
  shapingInstructions,
  type IdeaProject,
  type ShapingProject,
} from "../../domain/shaping.js";
import { TASK_KINDS, type Task, type TaskKind } from "../../domain/task.js";
import {
  INITIATIVE_PLANNING_BRIEF,
  INITIATIVE_PLANNING_INSTRUCTIONS,
  SHAPING_BRIEF,
  SHAPING_INSTRUCTIONS,
} from "../../domain/work-prompt-templates.js";
import { KnownPipelines } from "../../ports/known-pipelines.js";
import { KnownProjects } from "../../ports/known-projects.js";
import { TaskDecisions } from "../../ports/task-decisions.js";
import {
  MARK_PLANNED,
  PROPOSE_PIPELINE,
  START_PLANNING,
  WRITE_DEFINITION_OF_DONE,
  WRITE_BUG_DETAILS,
  WRITE_KIND,
  WRITE_PLAN,
  WRITE_TAGS,
} from "../office-tools/planning-office-tools.js";
import { withCallingRule } from "./calling-rule.js";
import { initiativeBranchReads } from "./initiative-branch-reads.js";

/**
 * The Office tools a shaping session adds to its person's own (spec §6, "A person's Office
 * tools"): it reads every record and Attachment. It changes its Initiative, straight while it is
 * shaping and by Proposal once it is active, with Office actions, which the session gets by its
 * person's duties (spec 5.4): the outcome, the Pipelines, its Tasks, their dependencies and which
 * Tasks it has. Only add_task or joining makes a Task part of it, as a Task the person creates with
 * create_task stands alone. It
 * asks the user's choices in a Decision on no Task, one at a time, whose waiting Conversations' own
 * section of the Brief words, so the shaping Brief doesn't read it. It answers a Decision for the
 * user when they ask, as every Thread the user talks in does, and calls a person when the user
 * asks (`CALLING_RULE`), on no Task, as a chat calls.
 */
export const SHAPING_OFFICE_TOOLS = [
  ...READING_OFFICE_TOOLS,
  OPEN_DECISION_TOOL,
  ANSWER_DECISION_TOOL,
  CONSULT_TOOL,
] as const;

/** The templates an Initiative's Thread renders its instructions and Brief from. */
const INITIATIVE_THREAD_PROMPT_TEMPLATES = [
  SHAPING_INSTRUCTIONS,
  SHAPING_BRIEF,
  INITIATIVE_PLANNING_INSTRUCTIONS,
  INITIATIVE_PLANNING_BRIEF,
];

/**
 * The Office tools of an Initiative's planning session: it reads every record and Attachment, moves
 * the Initiative's Tasks to Planning as their turn comes, writes each one's parts by its Task id,
 * opens a Decision on a Task that needs the user's answer, or one on no Task about the Initiative
 * as a whole, and answers one for the user when they
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
  WRITE_KIND,
  WRITE_BUG_DETAILS,
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
    private readonly promptTemplates: PromptTemplates,
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
    const prompts = await this.promptTemplates.textsOf(INITIATIVE_THREAD_PROMPT_TEMPLATES);
    if (planningThreadOf(initiative, threadId) === undefined) {
      return {
        instructions: withCallingRule(shapingInstructions(prompts)),
        officeTools: SHAPING_OFFICE_TOOLS,
        record: await this.shapingBrief(prompts, initiative, idea?.projectId, record, tasks),
        sessionRefusal,
        branchReads,
      };
    }
    return {
      instructions: withCallingRule(initiativePlanningInstructions(prompts)),
      officeTools: INITIATIVE_PLANNING_OFFICE_TOOLS,
      record: await this.planningBrief(prompts, initiative, record, tasks, threadId),
      sessionRefusal,
      branchReads,
    };
  }

  private async shapingBrief(
    prompts: PromptTexts,
    initiative: Initiative,
    ideaProjectId: string | undefined,
    record: string,
    tasks: readonly Task[],
  ): Promise<string> {
    const [officeWide, projects, ideaProject] = await Promise.all([
      this.pipelines.list(),
      readEach(initiativeProjectIds(tasks), (id) => this.shapingProject(id)),
      ideaProjectId === undefined ? undefined : this.ideaProject(ideaProjectId),
    ]);
    return shapingBrief(prompts, initiative, ideaProject, record, projects, officeWide);
  }

  /** Named by its id when the Project is gone. */
  private async ideaProject(id: string): Promise<IdeaProject> {
    return { id, name: (await this.projects.find(id))?.name ?? id };
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
    prompts: PromptTexts,
    initiative: Initiative,
    record: string,
    tasks: readonly Task[],
    threadId: string,
  ): Promise<string> {
    const [pipelines, waiting] = await Promise.all([
      this.pipelines.list(),
      this.decisions.openInThread(threadId),
    ]);
    const projects = await readEach(initiativeProjectIds(tasks), (id) => this.planningProject(id));
    return initiativePlanningBrief(prompts, {
      initiative,
      threadId,
      waiting,
      record,
      tasks,
      projects: projects.filter((project) => project !== undefined),
      pipelines,
    });
  }

  private async planningProject(id: string): Promise<InitiativePlanningProject | undefined> {
    const [project, pipelines, kindPipelines] = await Promise.all([
      this.projects.find(id),
      this.pipelines.listFor(id),
      this.kindPipelinesOf(id),
    ]);
    if (!project) return undefined;
    return {
      id,
      ownPipelines: pipelines.filter(({ projectId }) => projectId === id),
      kindPipelines,
      name: project.name,
      baseBranch: project.baseBranch,
      defaultPipeline: project.defaultPipeline,
      installCommand: project.installCommand,
      commands: project.commands,
    };
  }

  /** The Pipeline the Project gives each Kind, as its Tasks are proposed one. */
  private async kindPipelinesOf(id: string): Promise<Partial<Record<TaskKind, string>>> {
    const pipelines = await Promise.all(
      TASK_KINDS.map(
        async (kind) => [kind, await this.projects.defaultPipelineFor(id, kind)] as const,
      ),
    );
    return Object.fromEntries(pipelines.filter(([, pipeline]) => pipeline !== undefined));
  }
}
