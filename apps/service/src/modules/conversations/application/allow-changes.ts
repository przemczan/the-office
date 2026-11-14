import { Injectable } from "@nestjs/common";
import { CARETAKER } from "../../people/index.js";
import type { Thread } from "../domain/thread.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import type { UserRef } from "../domain/user.js";
import { ChangesAllowedRepository } from "../ports/changes-allowed-repository.js";
import { ThreadRunner } from "./thread-runner.js";
import { ThreadService } from "./thread-service.js";

/** What the log says when switching changes off stopped the Caretaker answering. */
const STOPPED_BY_SWITCHING_OFF = "Changes were switched off, so the answer stopped.";

/**
 * Allow changes (spec §2.4): the user's switch, per Caretaker Thread, that lets the Caretaker reach
 * the whole workstation but secrets. Each switch ends the Thread's session, so the next message
 * starts one under the new rules, and is logged as a line naming the user who switched it. A new
 * Thread starts with it off.
 */
@Injectable()
export class AllowChanges {
  constructor(
    private readonly changesAllowed: ChangesAllowedRepository,
    private readonly threads: ThreadService,
    private readonly runner: ThreadRunner,
  ) {}

  /** Whether changes are allowed in the Thread; undefined for a Thread with no such switch. */
  async inThread(thread: Thread): Promise<boolean | undefined> {
    return hasTheSwitch(thread) ? this.changesAllowed.isAllowed(thread.id) : undefined;
  }

  /**
   * Allows changes in the Caretaker's Thread. Refused in any other Thread, and while the Caretaker
   * is answering, whose session runs under the rules it started with.
   */
  async allow(threadId: string, by: UserRef): Promise<Thread> {
    const thread = await this.threads.read(threadId);
    if (!hasTheSwitch(thread)) {
      throw new ThreadRefused(["Only the Caretaker's chat has Allow changes."]);
    }
    if (await this.changesAllowed.isAllowed(threadId)) return thread;
    if (thread.state === "answering") {
      throw new ThreadRefused(["Wait for the answer to finish, then Allow changes."]);
    }
    await this.changesAllowed.allow(threadId, new Date());
    await this.runner.stopAnswering(threadId, STOPPED_BY_SWITCHING_OFF);
    await this.threads.log(threadId, [{ kind: "changes-allowed", allowed: true, by }]);
    return this.threads.read(threadId);
  }

  /**
   * Switches changes off in the Thread: its session ends at once, an answer under way too, and the
   * Caretaker only reads again. Nothing when they weren't allowed.
   */
  async switchOff(threadId: string, by: UserRef): Promise<Thread> {
    const thread = await this.threads.read(threadId);
    if (!(await this.changesAllowed.switchOff(threadId))) return thread;
    await this.runner.stopAnswering(threadId, STOPPED_BY_SWITCHING_OFF);
    await this.threads.log(threadId, [{ kind: "changes-allowed", allowed: false, by }]);
    return this.threads.read(threadId);
  }
}

/** Only the Caretaker's chat has the switch: Threads on Tasks keep the Office rules. */
function hasTheSwitch({ home, roleKey }: Thread): boolean {
  return home.kind === "chat" && roleKey === CARETAKER;
}
