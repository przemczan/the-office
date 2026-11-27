import { homedir } from "node:os";
import { Injectable, Logger } from "@nestjs/common";
import { KnowledgeBase } from "../../../platform/knowledge-base/knowledge-base.js";
import {
  CORE_AREA,
  EngineSessions,
  OfficeToolRegistry,
  type HomeAreas,
} from "../../engine/index.js";
import { CARETAKER, Duties, EngineCascade, RoleCards } from "../../people/index.js";
import { PromptTemplates, type PromptTexts } from "../../prompt-templates/index.js";
import { withOfficeToolAreas, type Brief, type BriefToolArea } from "../domain/brief.js";
import { BRIEF_OFFICE_TOOLS } from "../domain/brief-templates.js";
import { canCall } from "../domain/consult.js";
import { offeredToPerson } from "../domain/hand-written-tool-groups.js";
import {
  caretakerChatInstructions,
  chatInstructions,
  consultationInstructions,
  SESSION_INSTRUCTION_TEMPLATES,
  workThreadInstructions,
} from "../domain/session-instruction-templates.js";
import {
  ALLOW_CHANGES_ADVICE,
  caretakerChatOfficeTools,
  chatOfficeTools,
  consultationOfficeTools,
  personToolsRule,
  threadOfficeTools,
  type HeldDuties,
  type SessionPerson,
  type ThreadRecordKind,
  type ToolHolder,
} from "../domain/session-instructions.js";
import { cascadeLocationOf, type Thread } from "../domain/thread.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import { ChangesAllowedRepository } from "../ports/changes-allowed-repository.js";
import { ProjectBases, type InitiativeBranchReads } from "../ports/project-bases.js";
import { NO_MASK, ProjectOutputMasks, type TextMask } from "../ports/project-output-masks.js";
import { Briefs } from "./briefs.js";
import { CallChains } from "./call-chains.js";
import { InitiativeThreadSetups } from "./initiative-thread-setups.js";
import { taskThreadRequest, TaskThreadSetups, type TaskThreadSetup } from "./task-thread-setups.js";

/** Where a Thread's session works and what it is given, which its home decides. */
export interface SessionPlace {
  readonly folder: string;
  /**
   * The folders it reads besides its own: the knowledge base, and an Initiative's branch checkouts.
   */
  readonly readableFolders: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  /**
   * The Project checkout the session works in, for its skills and its MCP servers' Server values;
   * undefined for a chat's.
   */
  readonly project:
    | {
        readonly id: string;
        readonly folder: string;
        readonly useProjectSkills: boolean;
        readonly projectSkillsOff: readonly string[];
      }
    | undefined;
  /** Hides the Project's Secret variables in what the session writes into the Thread. */
  readonly mask: TextMask;
  readonly officeTools: readonly string[];
  /**
   * The areas, beside Core, whose tools the session loads from the start; the other areas' tools it
   * reaches on demand (spec 2.4.1 › What each Thread adds). `all` for a Stage and a Consultation,
   * whose lists are fixed.
   */
  readonly homeAreas: HomeAreas;
  /**
   * The session reaches the whole workstation but secrets, from the home folder: the Caretaker's
   * Thread with changes allowed (spec §2.4). Every other session only reads.
   */
  readonly workstation: boolean;
  /**
   * The session reads the engines' session transcripts, changes allowed or not: the Caretaker's
   * Threads, to find out what a session did (spec §6). Every other session is refused them.
   */
  readonly readsEngineTranscripts: boolean;
  /** What a refusal tells the Agent to do about it, such as asking to Allow changes. */
  readonly refusalAdvice: string | undefined;
  readonly brief: Brief;
  /** What its engine calls are tagged with, beside the Thread and the person. */
  readonly span: Readonly<Record<string, string>>;
  /**
   * The names its engine calls' metrics carry, beside the home and the person (spec §5.2): the
   * Project's and the Pipeline's, each `""` where none applies. Never an id.
   */
  readonly metric: SessionMetric;
  /**
   * The duties the Thread's person holds now, which decide their built-in tools and instructions;
   * a session started with others is never resumed (spec §2.2).
   */
  readonly heldDuties: HeldDuties;
  instructions(person: SessionPerson): string;
  /** Readies the folder as a session opens on it. */
  ready(): Promise<void>;
}

/** The names a session's metrics carry from its home. */
export interface SessionMetric {
  readonly "office.project": string;
  readonly "office.pipeline": string;
}

/** A session on no Project nor Pipeline: a chat's, or an Initiative's, which spans Projects. */
const NO_PROJECT_METRIC: SessionMetric = { "office.project": "", "office.pipeline": "" };

/**
 * A session's place as its home sets it up, before the duties its person holds and the texts its
 * instructions render with.
 */
type HomePlace = Omit<SessionPlace, "heldDuties" | "instructions"> & {
  instructions(
    prompts: PromptTexts,
    person: SessionPerson,
    /** The Office tools the session is offered, which what it is told to do follows. */
    offeredTools: readonly string[],
  ): string;
};

/** Where a session that only reads Projects' checkouts works. */
type ReadingPlace = Pick<
  SessionPlace,
  "folder" | "readableFolders" | "environment" | "project" | "mask" | "ready"
>;

/**
 * A chat session, or one on an Initiative, reads every Project's base branch with the service's own
 * variables (spec §6); a session on a Task works in the Task's worktree, or reads as a chat does
 * while the Task has none yet. The module keeping Work
 * sets up what a session on a Task or an Initiative is given. The Caretaker's chat with changes
 * allowed works in the home folder instead (spec §2.4). A Consultation reads as its home does and
 * works with its Consultant's own tools, never its asker's; it never writes.
 */
@Injectable()
export class SessionPlaces {
  private readonly logger = new Logger(SessionPlaces.name);

  constructor(
    private readonly bases: ProjectBases,
    private readonly briefs: Briefs,
    private readonly taskThreads: TaskThreadSetups,
    private readonly initiativeThreads: InitiativeThreadSetups,
    private readonly changesAllowed: ChangesAllowedRepository,
    private readonly masks: ProjectOutputMasks,
    private readonly chains: CallChains,
    private readonly duties: Duties,
    private readonly tools: OfficeToolRegistry,
    private readonly promptTemplates: PromptTemplates,
    private readonly knowledgeBase: KnowledgeBase,
    private readonly roleCards: RoleCards,
    private readonly engineCascade: EngineCascade,
    private readonly engineSessions: EngineSessions,
  ) {}

  /**
   * Every Thread the user talks to a person in also gets the Office actions' tools their Authority
   * doesn't rule Never (spec 5.4.1); a Stage's Thread does its Stage's work only, so gets none. Its
   * instructions render with the templates' texts as they are now, so a resumed session gets the
   * current text too. Every session reads the knowledge base its Brief names, never changing it.
   * `logBefore` is the id of the message the session answers, once it is logged
   * (`Briefs.forThread`).
   */
  async of(thread: Thread, logBefore?: string): Promise<SessionPlace> {
    const held = await this.duties.heldBy(thread.roleKey);
    const home = await this.homePlace(thread, held, logBefore);
    const prompts = await this.promptTemplates.textsOf(SESSION_INSTRUCTION_TEMPLATES);
    const officeTools = await this.offeredTools(thread, home.officeTools);
    return {
      ...home,
      brief: await this.briefWithToolAreas(thread, home, officeTools),
      readableFolders: [...this.knowledgeBase.readableFolders, ...home.readableFolders],
      officeTools,
      heldDuties: held,
      instructions: (person) => home.instructions(prompts, person, officeTools),
    };
  }

  /**
   * The home's Brief, followed by the Office tool areas the session loads and the other areas'
   * tools with how to reach them, on the engine the cascade gives the Thread (spec 6 › Tool areas).
   * As it is for a session that loads every tool: a Stage's or a Consultation's, or one on an
   * engine that loads them all. `offeredTools` holds no tool ruled Never, so the Brief names none.
   */
  private async briefWithToolAreas(
    thread: Thread,
    home: HomePlace,
    offeredTools: readonly string[],
  ): Promise<Brief> {
    const { homeAreas } = home;
    if (homeAreas === "all") return home.brief;
    const engine = await this.engineCascade.applying(
      thread.roleKey,
      cascadeLocationOf(thread.home, home.project?.id),
    );
    if (engine === null) return home.brief;
    const loading = await this.engineSessions.officeToolLoadingOf(engine.engineId);
    if (loading === "all") return home.brief;
    return withOfficeToolAreas(
      await this.promptTemplates.textsOf([BRIEF_OFFICE_TOOLS]),
      home.brief,
      { loading, homeAreas, others: this.otherAreas(offeredTools, homeAreas) },
    );
  }

  /** The offered tools outside Core and `homeAreas`, by area in the order the registry has them. */
  private otherAreas(
    offeredTools: readonly string[],
    homeAreas: readonly string[],
  ): BriefToolArea[] {
    const offered = new Set(offeredTools);
    const byArea = new Map<string, string[]>();
    for (const { name, area } of this.tools.areas()) {
      if (!offered.has(name) || area === CORE_AREA || homeAreas.includes(area)) continue;
      byArea.set(area, [...(byArea.get(area) ?? []), name]);
    }
    return [...byArea].map(([area, tools]) => ({ area, tools }));
  }

  /**
   * The Office tools the session is offered: its home's, and for a Thread the user talks in every
   * Office action's tool beside them, all but those its person's Authority rules Never (spec 6 ›
   * Tool areas). A Stage's fixed list is narrowed the same way, never widened (spec 2.3.1).
   */
  private async offeredTools(thread: Thread, homeTools: readonly string[]): Promise<string[]> {
    const card = await this.roleCards.find(thread.roleKey);
    if (!card) return [...homeTools];
    return offeredToPerson(
      thread.roleKey,
      card.authority,
      homeTools,
      this.tools.actionTools(),
      thread,
    );
  }

  private async homePlace(
    thread: Thread,
    held: HeldDuties,
    logBefore: string | undefined,
  ): Promise<HomePlace> {
    const { home } = thread;
    switch (home.kind) {
      case "chat":
        return this.chat(thread, held, logBefore);
      case "task":
        return this.task(thread, home.taskId, held, logBefore);
      case "initiative":
        return this.initiative(thread, home.initiativeId, held);
    }
  }

  private async task(
    thread: Thread,
    taskId: string,
    held: HeldDuties,
    logBefore: string | undefined,
  ): Promise<HomePlace> {
    const setup = await this.taskThreads.of(taskThreadRequest(thread, taskId));
    if (setup.sessionRefusal !== undefined) throw new ThreadRefused([setup.sessionRefusal]);
    return {
      ...(setup.folder === undefined
        ? await this.checkoutsPlace(thread, setup)
        : this.worktreePlace(setup, setup.folder)),
      environment: setup.environment,
      homeAreas: thread.consultation || thread.stageThread ? "all" : ["work"],
      mask: await this.masks.outputMaskOf(setup.projectId),
      workstation: false,
      readsEngineTranscripts: false,
      refusalAdvice: undefined,
      brief: await this.briefs.forTaskThread(thread, setup, logBefore),
      span: { "office.task": taskId, "office.initiative": setup.initiativeId ?? "" },
      metric: { "office.project": setup.projectName, "office.pipeline": setup.pipelineName },
      // A Task planned in its Initiative's Thread has no worktree yet to write the definition in.
      ...(thread.consultation
        ? await this.consultationTools(thread, held, setup.folder !== undefined)
        : this.workThreadTools(thread, held, setup, "task")),
    };
  }

  private worktreePlace(
    setup: TaskThreadSetup,
    worktree: string,
  ): Pick<SessionPlace, "folder" | "readableFolders" | "project" | "ready"> {
    return {
      folder: worktree,
      readableFolders: [],
      project: {
        id: setup.projectId,
        folder: worktree,
        useProjectSkills: setup.useProjectSkills,
        projectSkillsOff: setup.projectSkillsOff,
      },
      // The module keeping Tasks made the worktree before it opened the Thread.
      ready: () => Promise.resolve(),
    };
  }

  /**
   * A Task with no worktree yet, such as one planned in its Initiative's Thread that a Consultation
   * is asked on: its session reads the Projects' checkouts as a chat or the Initiative's Threads
   * do, its Project's skills from that Project's checkout.
   */
  private async checkoutsPlace(
    thread: Thread,
    setup: TaskThreadSetup,
  ): Promise<Pick<SessionPlace, "folder" | "readableFolders" | "project" | "ready">> {
    const { folder, readableFolders, ready } =
      setup.branchReads === undefined
        ? this.basesPlace(thread)
        : this.initiativeBranchPlace(thread, setup.branchReads);
    const checkout = (await this.bases.list()).find(
      ({ projectId }) => projectId === setup.projectId,
    );
    return {
      folder,
      readableFolders,
      project: {
        id: setup.projectId,
        folder: checkout?.folder ?? folder,
        useProjectSkills: setup.useProjectSkills,
        projectSkillsOff: setup.projectSkillsOff,
      },
      ready,
    };
  }

  /**
   * What a Consultation's session works with, from its Consultant alone (spec §6): their own tools,
   * `consult` while the chain of calls may ask one more, and nothing that waits in it or writes but
   * the run environment definition, on a Task (`onTask`), when the Consultant's card has the Run
   * environment capability now.
   */
  private async consultationTools(
    thread: Thread,
    held: HeldDuties,
    onTask: boolean,
  ): Promise<Pick<HomePlace, "officeTools" | "instructions">> {
    const consultation = {
      canCall: canCall(await this.chains.ofCaller(thread)),
      onTask,
      runEnvironment:
        onTask &&
        ((await this.roleCards.find(thread.roleKey))?.card.capabilities.runEnvironment ?? false),
    };
    return {
      officeTools: consultationOfficeTools(toolHolder(thread), consultation),
      instructions: (prompts, person) =>
        consultationInstructions(prompts, person, consultation.canCall, {
          onboardsProjects: held.includes("onboards-projects"),
          onTask,
          writesRunEnvironment: consultation.onTask && consultation.runEnvironment,
        }),
    };
  }

  private async chat(
    thread: Thread,
    held: HeldDuties,
    logBefore: string | undefined,
  ): Promise<HomePlace> {
    const brief = await this.briefs.forThread(thread, logBefore);
    if (thread.consultation) {
      return {
        ...this.basesPlace(thread),
        ...(await this.consultationTools(thread, held, false)),
        homeAreas: "all",
        brief,
        span: {},
        metric: NO_PROJECT_METRIC,
        workstation: false,
        readsEngineTranscripts: false,
        refusalAdvice: undefined,
      };
    }
    const caretaker = thread.roleKey === CARETAKER;
    const chat = {
      officeTools: caretaker ? caretakerChatOfficeTools() : chatOfficeTools(),
      homeAreas: [] as HomeAreas,
      brief,
      span: {},
      metric: NO_PROJECT_METRIC,
    };
    if (caretaker) return { ...chat, ...(await this.caretakerPlace(thread)) };
    return {
      ...this.basesPlace(thread),
      ...chat,
      workstation: false,
      readsEngineTranscripts: false,
      refusalAdvice: undefined,
      instructions: (prompts, person) => chatInstructions(prompts, person, held),
    };
  }

  /** The Caretaker reads as any chat does until the user allows changes in the Thread. */
  private async caretakerPlace(
    thread: Thread,
  ): Promise<Omit<HomePlace, "officeTools" | "homeAreas" | "brief" | "span" | "metric">> {
    if (!(await this.changesAllowed.isAllowed(thread.id))) {
      return {
        ...this.basesPlace(thread),
        workstation: false,
        readsEngineTranscripts: true,
        refusalAdvice: ALLOW_CHANGES_ADVICE,
        instructions: (prompts, person) => caretakerChatInstructions(prompts, person, false),
      };
    }
    return {
      folder: homedir(),
      readableFolders: [],
      environment: serviceEnvironment(),
      project: undefined,
      mask: NO_MASK,
      workstation: true,
      readsEngineTranscripts: true,
      refusalAdvice: undefined,
      instructions: (prompts, person) => caretakerChatInstructions(prompts, person, true),
      ready: () => Promise.resolve(),
    };
  }

  /**
   * An Initiative spans Projects, so its session reads every Project, as a chat's does: once it has
   * branches, at the Initiative's branch in the Projects `branchReads` names. Its folder stays the
   * base checkouts', even then, so a session started while shaping resumes after Confirm.
   */
  private async initiative(
    thread: Thread,
    initiativeId: string,
    held: HeldDuties,
  ): Promise<HomePlace> {
    const setup = await this.initiativeThreads.of({
      threadId: thread.id,
      initiativeId,
      roleKey: thread.roleKey,
    });
    if (setup.sessionRefusal !== undefined) throw new ThreadRefused([setup.sessionRefusal]);
    return {
      ...(setup.branchReads === undefined
        ? this.basesPlace(thread)
        : this.initiativeBranchPlace(thread, setup.branchReads)),
      ...this.workThreadTools(thread, held, setup, "initiative"),
      homeAreas: thread.stageThread ? "all" : ["work", "initiatives"],
      workstation: false,
      readsEngineTranscripts: false,
      refusalAdvice: undefined,
      brief: await this.briefs.forInitiativeThread(thread, setup),
      span: { "office.initiative": initiativeId },
      metric: NO_PROJECT_METRIC,
    };
  }

  /**
   * A Thread on a Task or an Initiative the user talks in has its person's own tools, as their chat
   * does, beside those its kind adds (spec §6, "A person's Office tools"); a Stage's Thread does
   * its Stage's work only.
   */
  private workThreadTools(
    thread: Thread,
    held: HeldDuties,
    setup: { readonly officeTools: readonly string[]; readonly instructions: string },
    onRecord: ThreadRecordKind,
  ): Pick<HomePlace, "officeTools" | "instructions"> {
    if (thread.stageThread) {
      return {
        officeTools: setup.officeTools,
        instructions: (prompts, person) =>
          workThreadInstructions(prompts, person, setup.instructions),
      };
    }
    const holder = toolHolder(thread);
    return {
      officeTools: threadOfficeTools(holder, setup.officeTools),
      instructions: (prompts, person, offered) =>
        workThreadInstructions(
          prompts,
          person,
          setup.instructions,
          personToolsRule(
            {
              offered,
              defaultPerson: held.includes("default-person-to-talk-to"),
              caretaker: holder.caretaker,
            },
            onRecord,
          ),
        ),
    };
  }

  private initiativeBranchPlace(thread: Thread, reads: InitiativeBranchReads): ReadingPlace {
    return {
      ...this.basesPlace(thread),
      readableFolders: [this.bases.initiativeFolder(reads.shortName)],
      ready: async () => {
        const projects = await this.bases.refreshOnInitiative(reads);
        const onBranch = projects.filter(
          ({ initiativeBranch }) => initiativeBranch?.gone === false,
        );
        this.logger.log(
          `Thread ${thread.id} reads ${reads.branch} in ${onBranch.length} Projects and ${projects.length - onBranch.length} Projects' base branches.`,
        );
      },
    };
  }

  private basesPlace(thread: Thread): ReadingPlace {
    return {
      folder: this.bases.folder,
      readableFolders: [],
      // The service's own: such a session runs no Project command, so no Project's changes to it.
      environment: serviceEnvironment(),
      project: undefined,
      mask: NO_MASK,
      ready: async () => {
        const projects = await this.bases.refresh();
        this.logger.log(`Thread ${thread.id} reads ${projects.length} Projects' base branches.`);
      },
    };
  }
}

/** Whose tools a Thread's session works with: its person's; only the Caretaker's differ in kind. */
function toolHolder({ roleKey }: Thread): ToolHolder {
  return { caretaker: roleKey === CARETAKER };
}

/** The variables the service runs with, which the engine filters The Office's own out of. */
function serviceEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}
