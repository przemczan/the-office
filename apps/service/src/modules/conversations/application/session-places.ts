import { Injectable, Logger } from "@nestjs/common";
import type { Brief } from "../domain/brief.js";
import {
  CHAT_OFFICE_TOOLS,
  chatInstructions,
  taskThreadInstructions,
  type SessionPersonCard,
} from "../domain/session-instructions.js";
import type { Thread } from "../domain/thread.js";
import { ProjectBases } from "../ports/project-bases.js";
import { Briefs } from "./briefs.js";
import { TaskThreadSetups } from "./task-thread-setups.js";

/** Where a Thread's session works and what it is given, which its home decides. */
export interface SessionPlace {
  readonly folder: string;
  readonly environment: Readonly<Record<string, string>>;
  /** The Project checkout the session works in, for its skills; undefined for a chat's. */
  readonly project: { readonly folder: string; readonly useProjectSkills: boolean } | undefined;
  readonly officeTools: readonly string[];
  readonly brief: Brief;
  /** What its engine calls are tagged with, beside the Thread and the person. */
  readonly span: Readonly<Record<string, string>>;
  instructions(card: SessionPersonCard): string;
  /** Readies the folder as a session opens on it. */
  ready(): Promise<void>;
}

/**
 * A chat session reads every Project's base branch with the service's own variables (spec §6); a
 * session on a Task works in the Task's worktree, as the module keeping Tasks sets it up.
 */
@Injectable()
export class SessionPlaces {
  private readonly logger = new Logger(SessionPlaces.name);

  constructor(
    private readonly bases: ProjectBases,
    private readonly briefs: Briefs,
    private readonly taskThreads: TaskThreadSetups,
  ) {}

  async of(thread: Thread): Promise<SessionPlace> {
    if (thread.home.kind === "chat") return this.chat(thread);
    const { taskId } = thread.home;
    const setup = await this.taskThreads.of({
      threadId: thread.id,
      taskId,
      roleKey: thread.roleKey,
    });
    return {
      folder: setup.folder,
      environment: setup.environment,
      project: { folder: setup.folder, useProjectSkills: setup.useProjectSkills },
      officeTools: setup.officeTools,
      brief: this.briefs.forTaskThread(thread, setup),
      span: { "office.task": taskId },
      instructions: (card) => taskThreadInstructions(card, setup.instructions),
      // The module keeping Tasks made the worktree before it opened the Thread.
      ready: () => Promise.resolve(),
    };
  }

  private async chat(thread: Thread): Promise<SessionPlace> {
    return {
      folder: this.bases.folder,
      // The service's own: a chat runs no Project command, so no Project's changes to it.
      environment: serviceEnvironment(),
      project: undefined,
      officeTools: CHAT_OFFICE_TOOLS,
      brief: await this.briefs.forThread(thread),
      span: {},
      instructions: chatInstructions,
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
