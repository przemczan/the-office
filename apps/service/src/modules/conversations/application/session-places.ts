import { homedir } from "node:os";
import { Injectable, Logger } from "@nestjs/common";
import { OfficeToolRegistry } from "../../engine/index.js";
import { CARETAKER, Duties } from "../../people/index.js";
import type { Brief } from "../domain/brief.js";
import { canCall } from "../domain/consult.js";
import {
  ALLOW_CHANGES_ADVICE,
  caretakerChatInstructions,
  caretakerChatOfficeTools,
  chatOfficeTools,
  chatInstructions,
  consultationInstructions,
  consultationOfficeTools,
  workThreadInstructions,
  type HeldDuties,
  type SessionPerson,
} from "../domain/session-instructions.js";
import type { Thread } from "../domain/thread.js";
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
  /** The folders it reads besides its own: an Initiative's branch checkouts; none for any other. */
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
  /** A held call has a Thread to wait in: a Stage's, or the Planner's in Planning. */
  readonly callsCanWait: boolean;
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
   * The duties the Thread's person holds now, which decide their built-in tools and instructions;
   * a session started with others is never resumed (spec §2.2).
   */
  readonly heldDuties: HeldDuties;
  instructions(person: SessionPerson): string;
  /** Readies the folder as a session opens on it. */
  ready(): Promise<void>;
}

/** A session's place as its home sets it up, before the duties its person holds. */
type HomePlace = Omit<SessionPlace, "heldDuties">;

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
  ) {}

  /**
   * Every Thread the user talks to a person in also gets the Office actions' tools their held
   * duties cover (spec 5.4); a Stage's Thread does its Stage's work only, so gets none.
   */
  async of(thread: Thread): Promise<SessionPlace> {
    const held = await this.duties.heldBy(thread.roleKey);
    const home = await this.homePlace(thread, held);
    const actionTools = thread.stageThread
      ? []
      : this.tools.coveredBy(held).filter((name) => !home.officeTools.includes(name));
    return { ...home, officeTools: [...home.officeTools, ...actionTools], heldDuties: held };
  }

  private async homePlace(thread: Thread, held: HeldDuties): Promise<HomePlace> {
    const { home } = thread;
    switch (home.kind) {
      case "chat":
        return this.chat(thread, held);
      case "task":
        return this.task(thread, home.taskId, held);
      case "initiative":
        return this.initiative(thread, home.initiativeId);
    }
  }

  private async task(thread: Thread, taskId: string, held: HeldDuties): Promise<HomePlace> {
    const setup = await this.taskThreads.of(taskThreadRequest(thread, taskId));
    if (setup.sessionRefusal !== undefined) throw new ThreadRefused([setup.sessionRefusal]);
    return {
      ...(setup.folder === undefined
        ? await this.checkoutsPlace(thread, setup)
        : this.worktreePlace(setup, setup.folder)),
      environment: setup.environment,
      mask: await this.masks.outputMaskOf(setup.projectId),
      workstation: false,
      readsEngineTranscripts: false,
      refusalAdvice: undefined,
      brief: await this.briefs.forTaskThread(thread, setup),
      span: { "office.task": taskId },
      ...(thread.consultation
        ? await this.consultationTools(thread, held)
        : {
            officeTools: setup.officeTools,
            callsCanWait: !setup.asking,
            instructions: (person: SessionPerson) =>
              workThreadInstructions(person, setup.instructions),
          }),
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
   * `consult` while the chain of calls may ask one more, and nothing that waits in it or writes.
   */
  private async consultationTools(
    thread: Thread,
    held: HeldDuties,
  ): Promise<Pick<SessionPlace, "officeTools" | "callsCanWait" | "instructions">> {
    const canCallMore = canCall(await this.chains.ofCaller(thread));
    return {
      officeTools: consultationOfficeTools(held, canCallMore),
      callsCanWait: false,
      instructions: (person) => consultationInstructions(person, canCallMore),
    };
  }

  private async chat(thread: Thread, held: HeldDuties): Promise<HomePlace> {
    const brief = await this.briefs.forThread(thread);
    if (thread.consultation) {
      return {
        ...this.basesPlace(thread),
        ...(await this.consultationTools(thread, held)),
        brief,
        span: {},
        workstation: false,
        readsEngineTranscripts: false,
        refusalAdvice: undefined,
      };
    }
    const caretaker = thread.roleKey === CARETAKER;
    const chat = {
      officeTools: caretaker ? caretakerChatOfficeTools(held) : chatOfficeTools(held),
      callsCanWait: false,
      brief,
      span: {},
    };
    if (caretaker) return { ...chat, ...(await this.caretakerPlace(thread)) };
    return {
      ...this.basesPlace(thread),
      ...chat,
      workstation: false,
      readsEngineTranscripts: false,
      refusalAdvice: undefined,
      instructions: (person) => chatInstructions(person, held),
    };
  }

  /** The Caretaker reads as any chat does until the user allows changes in the Thread. */
  private async caretakerPlace(
    thread: Thread,
  ): Promise<Omit<HomePlace, "officeTools" | "callsCanWait" | "brief" | "span">> {
    if (!(await this.changesAllowed.isAllowed(thread.id))) {
      return {
        ...this.basesPlace(thread),
        workstation: false,
        readsEngineTranscripts: true,
        refusalAdvice: ALLOW_CHANGES_ADVICE,
        instructions: (person) => caretakerChatInstructions(person, false),
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
      instructions: (person) => caretakerChatInstructions(person, true),
      ready: () => Promise.resolve(),
    };
  }

  /**
   * An Initiative spans Projects, so its session reads every Project, as a chat's does: once it has
   * branches, at the Initiative's branch in the Projects `branchReads` names. Its folder stays the
   * base checkouts', even then, so a session started while shaping resumes after Confirm.
   */
  private async initiative(thread: Thread, initiativeId: string): Promise<HomePlace> {
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
      officeTools: setup.officeTools,
      callsCanWait: false,
      workstation: false,
      readsEngineTranscripts: false,
      refusalAdvice: undefined,
      brief: await this.briefs.forInitiativeThread(thread, setup),
      span: { "office.initiative": initiativeId },
      instructions: (person) => workThreadInstructions(person, setup.instructions),
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

/** The variables the service runs with, which the engine filters The Office's own out of. */
function serviceEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}
