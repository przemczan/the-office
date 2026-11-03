import { homedir } from "node:os";
import { Injectable, Logger } from "@nestjs/common";
import { CARETAKER } from "../../people/index.js";
import type { Brief } from "../domain/brief.js";
import {
  ALLOW_CHANGES_ADVICE,
  caretakerChatInstructions,
  chatOfficeTools,
  CONSULTATION_OFFICE_TOOLS,
  chatInstructions,
  consultationInstructions,
  workThreadInstructions,
  type SessionPersonCard,
} from "../domain/session-instructions.js";
import type { Thread } from "../domain/thread.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import { ChangesAllowedRepository } from "../ports/changes-allowed-repository.js";
import { ProjectBases } from "../ports/project-bases.js";
import { Briefs } from "./briefs.js";
import { InitiativeThreadSetups } from "./initiative-thread-setups.js";
import { TaskThreadSetups } from "./task-thread-setups.js";

/** Where a Thread's session works and what it is given, which its home decides. */
export interface SessionPlace {
  readonly folder: string;
  readonly environment: Readonly<Record<string, string>>;
  /**
   * The Project checkout the session works in, for its skills and its MCP servers' Server values;
   * undefined for a chat's.
   */
  readonly project:
    | { readonly id: string; readonly folder: string; readonly useProjectSkills: boolean }
    | undefined;
  readonly officeTools: readonly string[];
  /**
   * The session reaches the whole workstation but secrets, from the home folder: the Caretaker's
   * Thread with changes allowed (spec §2.4). Every other session only reads.
   */
  readonly workstation: boolean;
  /** What a refusal tells the Agent to do about it, such as asking to Allow changes. */
  readonly refusalAdvice: string | undefined;
  readonly brief: Brief;
  /** What its engine calls are tagged with, beside the Thread and the person. */
  readonly span: Readonly<Record<string, string>>;
  instructions(card: SessionPersonCard): string;
  /** Readies the folder as a session opens on it. */
  ready(): Promise<void>;
}

/**
 * A chat session, or one on an Initiative, reads every Project's base branch with the service's own
 * variables (spec §6); a session on a Task works in the Task's worktree. The module keeping Work
 * sets up what a session on a Task or an Initiative is given. The Caretaker's chat with changes
 * allowed works in the home folder instead (spec §2.4).
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
  ) {}

  async of(thread: Thread): Promise<SessionPlace> {
    const { home } = thread;
    switch (home.kind) {
      case "chat":
        return this.chat(thread);
      case "task":
        return this.task(thread, home.taskId);
      case "initiative":
        return this.initiative(thread, home.initiativeId);
    }
  }

  private async task(thread: Thread, taskId: string): Promise<SessionPlace> {
    const setup = await this.taskThreads.of({
      threadId: thread.id,
      taskId,
      roleKey: thread.roleKey,
    });
    if (setup.sessionRefusal !== undefined) throw new ThreadRefused([setup.sessionRefusal]);
    return {
      folder: setup.folder,
      environment: setup.environment,
      project: {
        id: setup.projectId,
        folder: setup.folder,
        useProjectSkills: setup.useProjectSkills,
      },
      officeTools: thread.consultation ? CONSULTATION_OFFICE_TOOLS : setup.officeTools,
      workstation: false,
      refusalAdvice: undefined,
      brief: await this.briefs.forTaskThread(thread, setup),
      span: { "office.task": taskId },
      instructions: (card) =>
        thread.consultation
          ? consultationInstructions(card)
          : workThreadInstructions(card, setup.instructions),
      // The module keeping Tasks made the worktree before it opened the Thread.
      ready: () => Promise.resolve(),
    };
  }

  private async chat(thread: Thread): Promise<SessionPlace> {
    const chat = {
      officeTools: chatOfficeTools(thread.roleKey),
      brief: await this.briefs.forThread(thread),
      span: {},
    };
    if (thread.roleKey === CARETAKER) return { ...chat, ...(await this.caretakerPlace(thread)) };
    return {
      ...this.basesPlace(thread),
      ...chat,
      workstation: false,
      refusalAdvice: undefined,
      instructions: (card) => chatInstructions(card, thread.roleKey),
    };
  }

  /** The Caretaker reads as any chat does until the user allows changes in the Thread. */
  private async caretakerPlace(
    thread: Thread,
  ): Promise<Omit<SessionPlace, "officeTools" | "brief" | "span">> {
    if (!(await this.changesAllowed.isAllowed(thread.id))) {
      return {
        ...this.basesPlace(thread),
        workstation: false,
        refusalAdvice: ALLOW_CHANGES_ADVICE,
        instructions: (card) => caretakerChatInstructions(card, false),
      };
    }
    return {
      folder: homedir(),
      environment: serviceEnvironment(),
      project: undefined,
      workstation: true,
      refusalAdvice: undefined,
      instructions: (card) => caretakerChatInstructions(card, true),
      ready: () => Promise.resolve(),
    };
  }

  /** An Initiative spans Projects, so its session reads every base branch, as a chat's does. */
  private async initiative(thread: Thread, initiativeId: string): Promise<SessionPlace> {
    const setup = await this.initiativeThreads.of({
      threadId: thread.id,
      initiativeId,
      roleKey: thread.roleKey,
    });
    if (setup.sessionRefusal !== undefined) throw new ThreadRefused([setup.sessionRefusal]);
    return {
      ...this.basesPlace(thread),
      officeTools: setup.officeTools,
      workstation: false,
      refusalAdvice: undefined,
      brief: await this.briefs.forInitiativeThread(thread, setup),
      span: { "office.initiative": initiativeId },
      instructions: (card) => workThreadInstructions(card, setup.instructions),
    };
  }

  private basesPlace(
    thread: Thread,
  ): Pick<SessionPlace, "folder" | "environment" | "project" | "ready"> {
    return {
      folder: this.bases.folder,
      // The service's own: such a session runs no Project command, so no Project's changes to it.
      environment: serviceEnvironment(),
      project: undefined,
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
