import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { KeyedLocks } from "../../../platform/locks/keyed-locks.js";
import { ProjectRefused } from "../domain/project-refused.js";
import {
  NOBODY_ONBOARDS_PROJECTS,
  TEST_TARGETS_PROPOSAL_OPEN,
  testTargetsChatStanding,
  testTargetsChatTitle,
  type TestTargetsChat,
  type TestTargetsChatAsker,
  type TestTargetsChatState,
} from "../domain/test-targets-chat.js";
import { TestTargetsChatAsked } from "../domain/test-targets-chat-events.js";
import { TestTargetsChatRepository } from "../ports/test-targets-chat-repository.js";
import { ProjectFeatures } from "./project-features.js";
import { ProjectService } from "./project-service.js";
import { TestTargetsChatThreads } from "./test-targets-chat-threads.js";
import { TestTargetsSetUpTasks, type TestTargetsSetUpTask } from "./test-targets-set-up-tasks.js";

/** The chat the Project page follows, as its card shows it. */
export interface FollowedTestTargetsChat {
  readonly threadId: string;
  readonly roleKey: string;
  readonly state: TestTargetsChatState;
  readonly since: Date;
}

/** The Project page's Set up test targets: the chat it follows, and a set-up Task made before. */
export interface ProjectTestTargetsChat {
  /** Undefined once its Proposal was applied or dismissed, or while none was asked. */
  readonly chat: FollowedTestTargetsChat | undefined;
  readonly setUpTask: TestTargetsSetUpTask | undefined;
}

/**
 * Set up test targets as a chat (spec §2.12): Ask starts a chat Thread with whoever holds
 * "Onboards and repairs Projects", titled for the Project, with no message sent, and the page
 * follows the newest one asked until its `test-targets` Proposal is applied or dismissed.
 */
@Injectable()
export class TestTargetsChats {
  /** By Project, so two Asks at once start one Thread after the other, never side by side. */
  private readonly locks = new KeyedLocks();

  constructor(
    private readonly projects: ProjectService,
    private readonly features: ProjectFeatures,
    private readonly repository: TestTargetsChatRepository,
    private readonly threads: TestTargetsChatThreads,
    private readonly setUpTasks: TestTargetsSetUpTasks,
    private readonly events: EventBus,
  ) {}

  /** The chat the Project's page follows and its open set-up Task; ProjectNotFound for none. */
  async read(projectId: string): Promise<ProjectTestTargetsChat> {
    await this.projects.read(projectId);
    const [chat, setUpTask] = await Promise.all([
      this.followed(projectId),
      this.setUpTasks.openOf(projectId),
    ]);
    return { chat, setUpTask };
  }

  /**
   * Ask, or Ask again: a new chat Thread the page follows from now. Refused while nobody holds
   * the duty, while the followed chat's Proposal is open, and (FeatureSwitchedOff) while the
   * Project has Test targets switched off.
   */
  async ask(projectId: string, by: TestTargetsChatAsker): Promise<ProjectTestTargetsChat> {
    const project = await this.projects.read(projectId);
    await this.features.ensureOn(projectId, "test-targets");
    const chat = await this.locks.run(projectId, async () => {
      if ((await this.followed(projectId))?.state === "proposal") {
        throw new ProjectRefused([TEST_TARGETS_PROPOSAL_OPEN]);
      }
      const start = await this.threads.start(testTargetsChatTitle(project.name));
      if (start.kind === "nobody") throw new ProjectRefused([NOBODY_ONBOARDS_PROJECTS]);
      if (start.kind === "refused") throw new ProjectRefused(start.reasons);
      const asked: TestTargetsChat = {
        projectId,
        threadId: start.threadId,
        roleKey: start.roleKey,
        askedBy: { userId: by.userId, name: by.name },
        askedAt: new Date(),
      };
      await this.repository.add(asked);
      return asked;
    });
    await this.events.publish(new TestTargetsChatAsked(chat));
    return this.read(projectId);
  }

  private async followed(projectId: string): Promise<FollowedTestTargetsChat | undefined> {
    const chat = await this.repository.newestOf(projectId);
    if (!chat) return undefined;
    const standing = testTargetsChatStanding(
      chat,
      await this.threads.read(chat.threadId, projectId),
    );
    if (standing.kind === "ended") return undefined;
    return {
      threadId: chat.threadId,
      roleKey: chat.roleKey,
      state: standing.state,
      since: standing.since,
    };
  }
}
